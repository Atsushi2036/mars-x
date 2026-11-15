import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { raycastTerrain } from '@/core/mission/geometry'
import type { Heightfield } from '@/core/terrain/heightfield'
import { agentLive, cameraRig, flyTo, FPV, resetNorth, useCamera, zoomBy, type FlyRequest } from '@/store/camera'
import { azimuthOf, clampDistance, clampPitch, clampToTile, DIST_MAX, easeInOut, lerpAngle, orbitPosition, panStep, smoothDamp } from '@/store/camera-math'
import { useMission } from '@/store/mission'
import { useApp } from '@/store/app'
import { roverLive } from '@/store/rover'

const EYE_SMOOTH = 14
const LOOK_SENS = 0.0022
const DOUBLE_TAP_MS = 350
const TAP_SLOP = 8
/** zoom factor of one +/- press (25 % of the distance) */
export const ZOOM_STEP = 0.75
/** Follow camera settle time (s) */
const CHASE_SMOOTH_S = 0.4

/**
 * One camera, three modes, one store (`useCamera`):
 *  - orbit: drei OrbitControls with limits; the target rides on the terrain and the camera never goes underground.
 *           Smooth moves (`flyTo`, home, north, zoom, minimap, double-click), WASD/QE/+- keys, target kept inside the tile.
 *  - fpv:   PointerLock + WASD on desktop, virtual joystick + drag on touch; eye 1.7 m above `sampleHeight`
 *  - chase: Follow, the POV of the active agent (rover, astronaut or a replayed episode) from behind; drag to look around
 */
/**
 * Angle (radians) the view has to tilt up so the centre of the part of the canvas that is not covered by a full-width panel
 * (elements marked `data-cover="top|bottom"`) lands on the aim point (positive when the bottom is more covered than the top),
 * and the fraction of the canvas height that stays visible (the box has to fit in that band).
 */
function visibleBand(canvas: HTMLElement, fovDeg: number): { angle: number; fraction: number } {
  const r = canvas.getBoundingClientRect()
  if (r.height < 1) return { angle: 0, fraction: 1 }
  let top = 0
  let bottom = 0
  for (const el of document.querySelectorAll<HTMLElement>('[data-cover]')) {
    const b = el.getBoundingClientRect()
    if (b.width < r.width * 0.6 || b.height < 1) continue
    if (el.dataset.cover === 'top') top = Math.max(top, b.bottom - r.top)
    else if (el.dataset.cover === 'bottom') bottom = Math.max(bottom, r.bottom - b.top)
  }
  const cap = r.height * 0.7
  top = Math.min(top, cap)
  bottom = Math.min(bottom, cap)
  return { angle: (((bottom - top) / 2) / r.height) * ((fovDeg * Math.PI) / 180), fraction: Math.max(0.3, (r.height - top - bottom) / r.height) }
}

interface Flight {
  t0: number
  ms: number
  from: { x: number; z: number; dist: number; yaw: number; pitch: number }
  to: { x: number; z: number; dist: number; yaw: number; pitch: number }
}

const typingTarget = (e: KeyboardEvent): boolean => {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

export function CameraRig({ hf }: { hf: Heightfield }) {
  const mode = useCamera((s) => s.mode)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const prevMode = useRef(mode)
  const keys = useRef(new Set<string>())
  const tmp = useRef(new Vector3())
  const flight = useRef<Flight | null>(null)
  /** Follow: how far the user has dragged the view around the agent (springs back when released) */
  const look = useRef({ yaw: 0, pitch: 0, idle: 0 })
  const chaseVel = useRef({ x: { v: 0 }, y: { v: 0 }, z: { v: 0 } })

  const ext = hf.extent
  const half = Math.max(ext.xMax - ext.xMin, ext.zMax - ext.zMin) / 2
  const maxDist = Math.min(DIST_MAX, half * 3)

  // initial framing: south of the centre, looking north-ish over the whole window
  useEffect(() => {
    const cy = hf.sampleHeight(0, 0)
    const dx = half * 0.1
    const dy = half * 0.55
    const dz = half * 0.95
    camera.position.set(dx, cy + dy, dz)
    camera.near = 0.5
    camera.far = 9000
    camera.updateProjectionMatrix()
    const c = controls.current
    if (c) {
      c.target.set(0, cy, 0)
      c.update()
    }
    cameraRig.focus = { x: 0, y: cy, z: 0 }
    const dist = Math.hypot(dx, dy, dz)
    cameraRig.homePose = { x: 0, z: 0, dist, yaw: azimuthOf(dx, dz), pitch: Math.asin(dy / dist) }
  }, [camera, hf, half])

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typingTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return
      keys.current.add(e.code)
      cameraRig.sprint = e.shiftKey
      const m = useCamera.getState().mode
      if (e.code === 'Digit1') useCamera.getState().setMode('orbit')
      if (e.code === 'Digit2') useCamera.getState().setMode('fpv')
      if (e.code === 'Digit3') useCamera.getState().setMode('chase')
      if (e.code === 'KeyR' || e.code === 'Home') cameraRig.home()
      if (e.code === 'KeyN') resetNorth()
      if (e.code === 'KeyF' && m === 'orbit') {
        const a = agentLive.ready ? agentLive : roverLive
        flyTo({ x: a.x, z: a.z, dist: Math.min(cameraRig.pose.dist || 140, 140) }, 900)
      }
      if (m === 'orbit' && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) zoomBy(ZOOM_STEP)
      if (m === 'orbit' && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) zoomBy(1 / ZOOM_STEP)
    }
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code)
      cameraRig.sprint = e.shiftKey
    }
    const blur = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // pointer lock (desktop) + touch look (drag) + Follow look-around + double-click / double-tap fly-to
  useEffect(() => {
    const el = gl.domElement
    const onClick = () => {
      if (useCamera.getState().mode === 'fpv' && !cameraRig.pointerLocked && window.matchMedia('(pointer: fine)').matches) {
        void el.requestPointerLock?.()
      }
    }
    const onLockChange = () => {
      cameraRig.pointerLocked = document.pointerLockElement === el
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!cameraRig.pointerLocked) return
      cameraRig.lookDelta.yaw -= e.movementX * LOOK_SENS
      cameraRig.lookDelta.pitch -= e.movementY * LOOK_SENS
    }
    let touchId: number | null = null
    let lx = 0
    let ly = 0
    let dragId: number | null = null
    let down: { x: number; y: number; t: number } | null = null
    let lastTap: { x: number; y: number; t: number; mission: ReturnType<typeof snapshotMission> | null } | null = null
    const onDown = (e: PointerEvent) => {
      flight.current = null // the user takes over from any smooth move
      down = { x: e.clientX, y: e.clientY, t: performance.now() }
      const m = useCamera.getState().mode
      if (e.pointerType === 'touch' && m === 'fpv' && touchId === null) {
        touchId = e.pointerId
        lx = e.clientX
        ly = e.clientY
      }
      if (m === 'chase' && dragId === null) {
        dragId = e.pointerId
        lx = e.clientX
        ly = e.clientY
      }
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === touchId) {
        cameraRig.lookDelta.yaw -= (e.clientX - lx) * LOOK_SENS * 1.4
        cameraRig.lookDelta.pitch -= (e.clientY - ly) * LOOK_SENS * 1.4
        lx = e.clientX
        ly = e.clientY
      } else if (e.pointerId === dragId) {
        look.current.yaw = Math.max(-Math.PI, Math.min(Math.PI, look.current.yaw + (e.clientX - lx) * 0.006))
        look.current.pitch = Math.max(-0.35, Math.min(0.9, look.current.pitch + (e.clientY - ly) * 0.004))
        look.current.idle = 0
        lx = e.clientX
        ly = e.clientY
      }
    }
    // capture phase: runs before the Mission layer's own click handler, so a double tap can undo the endpoint the first tap placed
    const onUpCapture = (e: PointerEvent) => {
      if (e.pointerId === touchId) touchId = null
      if (e.pointerId === dragId) dragId = null
      const d = down
      down = null
      if (!d || e.button !== 0) return
      const now = performance.now()
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP || now - d.t > 450) {
        lastTap = null
        return
      }
      const mode = useCamera.getState().mode
      if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        const snap = lastTap.mission
        lastTap = null
        if (mode === 'chase') return
        const r = el.getBoundingClientRect()
        const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }
        const o = camera.position
        const v = tmp.current.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(o)
        const hit = raycastTerrain(hf, o, v)
        if (hit) {
          if (mode === 'fpv') cameraRig.jumpTo = { x: hit.x, z: hit.z }
          else flyTo({ x: hit.x, z: hit.z, dist: Math.max(Math.min(cameraRig.pose.dist, 400) * 0.5, 80) }, 900)
          window.dispatchEvent(new CustomEvent('marsx:ripple', { detail: { x: e.clientX, y: e.clientY } }))
        }
        // Mission: a double click flies, it must not leave two endpoints behind
        if (snap) setTimeout(() => useMission.setState(snap), 0)
        return
      }
      lastTap = { x: e.clientX, y: e.clientY, t: now, mission: useApp.getState().mode === 'mission' ? snapshotMission() : null }
    }
    const onWheel = () => {
      flight.current = null
    }
    el.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouseMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUpCapture, true)
    el.addEventListener('pointercancel', onUpCapture, true)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUpCapture, true)
      el.removeEventListener('pointercancel', onUpCapture, true)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, camera, hf])

  // leaving fpv releases the pointer
  useEffect(() => {
    if (mode !== 'fpv' && document.pointerLockElement) document.exitPointerLock()
  }, [mode])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const c = controls.current
    const f = cameraRig.fpv
    const clampX = (x: number) => clampToTile(x, 0, ext).x
    const clampZ = (z: number) => clampToTile(0, z, ext).z
    const agent = agentLive.ready ? agentLive : roverLive

    // ---- mode transitions -------------------------------------------------------------------
    if (prevMode.current !== mode) {
      flight.current = null
      if (mode === 'fpv') {
        const dir = camera.getWorldDirection(tmp.current)
        const base = prevMode.current === 'orbit' && c ? c.target : camera.position
        f.x = clampX(base.x)
        f.z = clampZ(base.z)
        f.yaw = Math.atan2(-dir.x, -dir.z)
        f.pitch = 0
        f.eyeY = hf.sampleHeight(f.x, f.z) + FPV.eyeHeight
      } else if (mode === 'chase' && agent.ready) {
        // snap behind the agent instead of flying in from wherever the previous camera was
        look.current = { yaw: 0, pitch: 0, idle: 0 }
        chaseVel.current = { x: { v: 0 }, y: { v: 0 }, z: { v: 0 } }
        const back = agentLive.kind === 'astronaut' ? 3.4 : 9
        const tx = agent.x - Math.cos(agent.yaw) * back
        const tz = agent.z - Math.sin(agent.yaw) * back
        camera.position.set(tx, Math.max(hf.sampleHeight(tx, tz) + 2.5, hf.sampleHeight(agent.x, agent.z) + 4.2), tz)
      } else if (mode === 'orbit' && c) {
        const dir = camera.getWorldDirection(tmp.current)
        const gx = camera.position.x + dir.x * 40
        const gz = camera.position.z + dir.z * 40
        c.target.set(gx, hf.sampleHeight(gx, gz), gz)
        c.update()
        // coming back from Walk or Follow: rise to a readable view above the spot (the rover when following it)
        const from = prevMode.current === 'chase' ? agent : prevMode.current === 'fpv' ? { x: f.x, z: f.z } : null
        if (from) flyTo({ x: from.x, z: from.z, dist: 90, pitch: 0.75 }, 900)
      }
      prevMode.current = mode
    }
    if (cameraRig.jumpTo) {
      const j = cameraRig.jumpTo
      cameraRig.jumpTo = null
      f.x = clampX(j.x)
      f.z = clampZ(j.z)
      f.eyeY = hf.sampleHeight(f.x, f.z) + FPV.eyeHeight
    }

    if (c) c.enabled = mode === 'orbit'

    // ---- smooth moves (flyTo / home / north / zoom) ---------------------------------------
    const req: FlyRequest | null = cameraRig.flyRequest
    if (req) {
      cameraRig.flyRequest = null
      if (mode === 'orbit' && c) {
        const off = tmp.current.copy(camera.position).sub(c.target)
        const dist = off.length()
        const cur = { x: c.target.x, z: c.target.z, dist, yaw: azimuthOf(off.x, off.z), pitch: Math.asin(Math.max(-1, Math.min(1, off.y / Math.max(dist, 1e-6)))) }
        // successive zoom presses compound on the pending target instead of restarting from the half-way pose
        const base = flight.current && req.distFactor !== undefined ? flight.current.to : cur
        const to = {
          x: req.x !== undefined ? clampX(req.x) : base.x,
          z: req.z !== undefined ? clampZ(req.z) : base.z,
          dist: clampDistance(req.dist ?? base.dist * (req.distFactor ?? 1), maxDist),
          yaw: req.yaw ?? base.yaw,
          pitch: clampPitch(req.pitch ?? base.pitch),
        }
        flight.current = req.ms > 0 ? { t0: performance.now(), ms: req.ms, from: cur, to } : null
        if (req.ms <= 0) applyPose(to)
      } else if (mode === 'fpv') {
        if (req.x !== undefined && req.z !== undefined) cameraRig.jumpTo = { x: req.x, z: req.z }
        if (req.yaw !== undefined) f.yaw = req.yaw
      }
    }
    const fl = flight.current
    if (fl && mode === 'orbit' && c) {
      const s = easeInOut((performance.now() - fl.t0) / fl.ms)
      applyPose({
        x: fl.from.x + (fl.to.x - fl.from.x) * s,
        z: fl.from.z + (fl.to.z - fl.from.z) * s,
        dist: Math.exp(Math.log(fl.from.dist) + (Math.log(fl.to.dist) - Math.log(fl.from.dist)) * s),
        yaw: lerpAngle(fl.from.yaw, fl.to.yaw, s),
        pitch: fl.from.pitch + (fl.to.pitch - fl.from.pitch) * s,
      })
      if (s >= 1) flight.current = null
    }

    function applyPose(p: { x: number; z: number; dist: number; yaw: number; pitch: number }) {
      if (!c) return
      const ty = hf.sampleHeight(p.x, p.z)
      c.target.set(p.x, ty, p.z)
      const pos = orbitPosition({ x: p.x, y: ty, z: p.z }, p.yaw, p.pitch, p.dist)
      camera.position.set(pos.x, pos.y, pos.z)
      c.update()
    }

    // focusBounds(): centre the orbit target on the box and back off until it fits
    if (cameraRig.focusRequest && mode === 'orbit' && c) {
      const b = cameraRig.focusRequest
      cameraRig.focusRequest = null
      flight.current = null
      const cx = clampX((b.minX + b.maxX) / 2)
      const cz = clampZ((b.minZ + b.maxZ) / 2)
      const radius = Math.max(12, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2)
      const persp = camera as PerspectiveCamera
      const halfV = (persp.fov * Math.PI) / 360
      const halfH = Math.atan(Math.tan(halfV) * persp.aspect)
      const band = visibleBand(gl.domElement, persp.fov)
      const dist = Math.min(half * 3, Math.max(30, (radius * 1.25) / Math.sin(Math.min(halfV * band.fraction, halfH))))
      const az = Math.atan2(camera.position.z - c.target.z, camera.position.x - c.target.x)
      const pitch = (50 * Math.PI) / 180
      // panels over the canvas (phone sheet at the bottom, tour card at the top) hide part of the view: aim so the box sits in the visible band
      const shift = dist * band.angle * 0.5
      const tx = clampX(cx + Math.cos(az) * shift)
      const tz = clampZ(cz + Math.sin(az) * shift)
      const ty = hf.sampleHeight(tx, tz)
      c.target.set(tx, ty, tz)
      camera.position.set(tx + Math.cos(az) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, tz + Math.sin(az) * Math.cos(pitch) * dist)
      c.update()
    }

    // ---- per mode -----------------------------------------------------------------------------
    if (mode === 'orbit' && c) {
      const k = keys.current
      // keyboard: WASD / arrows pan relative to the heading, Q / E rotate around the target
      const kf = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
      const ks = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
      const kr = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0)
      if (kf || ks || kr || cameraRig.zoomHold) {
        flight.current = null
        const off = tmp.current.copy(camera.position).sub(c.target)
        if (kr) {
          const a = kr * 1.3 * dt
          const cs = Math.cos(a)
          const sn = Math.sin(a)
          off.set(off.x * cs - off.z * sn, off.y, off.x * sn + off.z * cs)
        }
        if (cameraRig.zoomHold) off.multiplyScalar(Math.exp(cameraRig.zoomHold * dt * 1.4))
        const len = Math.min(maxDist, Math.max(20, off.length()))
        off.setLength(len)
        let mx = 0
        let mz = 0
        if (kf || ks) {
          const norm = Math.hypot(kf, ks) || 1
          const d = panStep(azimuthOf(off.x, off.z), kf / norm, ks / norm, len * 0.7 * dt * (cameraRig.sprint ? 2.5 : 1))
          mx = d.x
          mz = d.z
        }
        c.target.x += mx
        c.target.z += mz
        camera.position.set(c.target.x + off.x, c.target.y + off.y, c.target.z + off.z)
        c.update()
      }
      // keep the target inside the tile (the camera moves with it), on the ground, and the camera above it
      const cl = clampToTile(c.target.x, c.target.z, ext)
      camera.position.x += cl.x - c.target.x
      camera.position.z += cl.z - c.target.z
      const tx = cl.x
      const tz = cl.z
      const ground = hf.sampleHeight(tx, tz)
      const dy = ground - c.target.y
      c.target.set(tx, c.target.y + dy * Math.min(1, dt * 8), tz)
      camera.position.y += dy * Math.min(1, dt * 8)
      const floor = hf.sampleHeight(camera.position.x, camera.position.z) + 3
      if (camera.position.y < floor) camera.position.y = floor
      cameraRig.focus.x = c.target.x
      cameraRig.focus.y = c.target.y
      cameraRig.focus.z = c.target.z
      cameraRig.pose.dist = camera.position.distanceTo(c.target)
    } else if (mode === 'fpv') {
      f.yaw += cameraRig.lookDelta.yaw
      f.pitch = Math.max(-FPV.maxPitch, Math.min(FPV.maxPitch, f.pitch + cameraRig.lookDelta.pitch))
      cameraRig.lookDelta.yaw = 0
      cameraRig.lookDelta.pitch = 0
      const k = keys.current
      let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0)
      let str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
      fwd += cameraRig.joystick.y
      str += cameraRig.joystick.x
      const len = Math.hypot(fwd, str)
      if (len > 1) {
        fwd /= len
        str /= len
      }
      const speed = cameraRig.sprint ? FPV.sprintSpeed : FPV.walkSpeed
      const sy = Math.sin(f.yaw)
      const cy = Math.cos(f.yaw)
      f.x = clampX(f.x + (-sy * fwd + cy * str) * speed * dt)
      f.z = clampZ(f.z + (-cy * fwd - sy * str) * speed * dt)
      const ground = hf.sampleHeight(f.x, f.z)
      const target = ground + FPV.eyeHeight
      f.eyeY += (target - f.eyeY) * (1 - Math.exp(-EYE_SMOOTH * dt))
      if (f.eyeY < ground + 1.0) f.eyeY = ground + 1.0 // never below the surface, even on a steep drop
      camera.position.set(f.x, f.eyeY, f.z)
      camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ')
      cameraRig.focus.x = f.x
      cameraRig.focus.y = ground
      cameraRig.focus.z = f.z
    } else if (mode === 'chase' && agent.ready) {
      const lk = look.current
      // the look-around springs back to "behind the agent" a moment after the user lets go
      lk.idle += dt
      if (lk.idle > 1.6 && dragging(lk)) {
        const r = Math.exp(-2.5 * dt)
        lk.yaw *= r
        lk.pitch *= r
      }
      const astro = agentLive.kind === 'astronaut'
      const back = astro ? 3.4 : 9
      const heading = agent.yaw + lk.yaw
      const tx = agent.x - Math.cos(heading) * back
      const tz = agent.z - Math.sin(heading) * back
      const rg = hf.sampleHeight(agent.x, agent.z)
      const ty = Math.max(hf.sampleHeight(tx, tz) + 2.5, rg + (astro ? 2.3 : 4.2) + lk.pitch * back * 1.6)
      // critically damped follow: no whiplash in the zigzags, no overshoot when the agent stops
      camera.position.x = smoothDamp(camera.position.x, tx, chaseVel.current.x, CHASE_SMOOTH_S, dt)
      camera.position.y = smoothDamp(camera.position.y, ty, chaseVel.current.y, CHASE_SMOOTH_S, dt)
      camera.position.z = smoothDamp(camera.position.z, tz, chaseVel.current.z, CHASE_SMOOTH_S, dt)
      const floor = hf.sampleHeight(camera.position.x, camera.position.z) + 1.5
      if (camera.position.y < floor) camera.position.y = floor
      camera.lookAt(agent.x, rg + (astro ? 1.3 : 1.0), agent.z)
      cameraRig.focus.x = agent.x
      cameraRig.focus.y = rg
      cameraRig.focus.z = agent.z
    }

    // publish the pose for the compass and the minimap cone
    const dir = camera.getWorldDirection(tmp.current)
    cameraRig.azimuth = Math.atan2(-dir.x, -dir.z)
    cameraRig.pose.x = camera.position.x
    cameraRig.pose.z = camera.position.z
    cameraRig.pose.yaw = cameraRig.azimuth
    cameraRig.pose.fovDeg = (camera as PerspectiveCamera).fov
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      zoomToCursor
      minDistance={20}
      maxDistance={maxDist}
      minPolarAngle={(5 * Math.PI) / 180}
      maxPolarAngle={(80 * Math.PI) / 180}
      screenSpacePanning={false}
      rotateSpeed={0.7}
      panSpeed={0.9}
    />
  )
}

const dragging = (lk: { yaw: number; pitch: number }): boolean => Math.abs(lk.yaw) > 1e-3 || Math.abs(lk.pitch) > 1e-3

function snapshotMission() {
  const m = useMission.getState()
  return { origin: m.origin, destination: m.destination, placing: m.placing, outcomes: m.outcomes, scienceTargetId: m.scienceTargetId }
}
