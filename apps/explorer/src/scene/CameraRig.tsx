import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type ComponentRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import type { Heightfield } from '@/core/terrain/heightfield'
import { cameraRig, FPV, useCamera } from '@/store/camera'
import { roverLive } from '@/store/rover'

const EYE_SMOOTH = 14
const LOOK_SENS = 0.0022

/**
 * One camera, three modes, one store (`useCamera`):
 *  - orbit: drei OrbitControls with limits; the target rides on the terrain and the camera never goes underground
 *  - fpv:   PointerLock + WASD on desktop, virtual joystick + drag on touch; eye 1.7 m above `sampleHeight`
 *  - chase: follows the rover from behind
 */
export function CameraRig({ hf }: { hf: Heightfield }) {
  const mode = useCamera((s) => s.mode)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const prevMode = useRef(mode)
  const keys = useRef(new Set<string>())
  const tmp = useRef(new Vector3())

  const ext = hf.extent
  const half = Math.max(ext.xMax - ext.xMin, ext.zMax - ext.zMin) / 2

  // initial framing: south of the centre, looking north-ish over the whole window
  useEffect(() => {
    const cy = hf.sampleHeight(0, 0)
    camera.position.set(half * 0.1, cy + half * 0.55, half * 0.95)
    camera.near = 0.5
    camera.far = 9000
    camera.updateProjectionMatrix()
    const c = controls.current
    if (c) {
      c.target.set(0, cy, 0)
      c.update()
    }
    cameraRig.focus = { x: 0, y: cy, z: 0 }
  }, [camera, hf, half])

  // keyboard
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return
      keys.current.add(e.code)
      cameraRig.sprint = e.shiftKey
      if (e.code === 'Digit1') useCamera.getState().setMode('orbit')
      if (e.code === 'Digit2') useCamera.getState().setMode('fpv')
      if (e.code === 'Digit3') useCamera.getState().setMode('chase')
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

  // pointer lock (desktop) + touch look (drag)
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
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || useCamera.getState().mode !== 'fpv' || touchId !== null) return
      touchId = e.pointerId
      lx = e.clientX
      ly = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== touchId) return
      cameraRig.lookDelta.yaw -= (e.clientX - lx) * LOOK_SENS * 1.4
      cameraRig.lookDelta.pitch -= (e.clientY - ly) * LOOK_SENS * 1.4
      lx = e.clientX
      ly = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === touchId) touchId = null
    }
    el.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove', onMouseMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [gl])

  // leaving fpv releases the pointer
  useEffect(() => {
    if (mode !== 'fpv' && document.pointerLockElement) document.exitPointerLock()
  }, [mode])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1)
    const c = controls.current
    const f = cameraRig.fpv
    const margin = 2
    const clampX = (x: number) => Math.max(ext.xMin + margin, Math.min(ext.xMax - margin, x))
    const clampZ = (z: number) => Math.max(ext.zMin + margin, Math.min(ext.zMax - margin, z))

    // ---- mode transitions -------------------------------------------------------------------
    if (prevMode.current !== mode) {
      if (mode === 'fpv') {
        const dir = camera.getWorldDirection(tmp.current)
        const base = prevMode.current === 'orbit' && c ? c.target : camera.position
        f.x = clampX(base.x)
        f.z = clampZ(base.z)
        f.yaw = Math.atan2(-dir.x, -dir.z)
        f.pitch = 0
        f.eyeY = hf.sampleHeight(f.x, f.z) + FPV.eyeHeight
      } else if (mode === 'chase' && roverLive.ready) {
        // snap behind the rover instead of flying in from wherever the previous camera was
        const tx = roverLive.x - Math.cos(roverLive.yaw) * 9
        const tz = roverLive.z - Math.sin(roverLive.yaw) * 9
        camera.position.set(tx, Math.max(hf.sampleHeight(tx, tz) + 2.5, hf.sampleHeight(roverLive.x, roverLive.z) + 4.2), tz)
      } else if (mode === 'orbit' && c) {
        const dir = camera.getWorldDirection(tmp.current)
        const gx = camera.position.x + dir.x * 40
        const gz = camera.position.z + dir.z * 40
        c.target.set(gx, hf.sampleHeight(gx, gz), gz)
        c.update()
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

    // focusBounds(): centre the orbit target on the box and back off until it fits
    if (cameraRig.focusRequest && mode === 'orbit' && c) {
      const b = cameraRig.focusRequest
      cameraRig.focusRequest = null
      const cx = clampX((b.minX + b.maxX) / 2)
      const cz = clampZ((b.minZ + b.maxZ) / 2)
      const radius = Math.max(12, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2)
      const persp = camera as PerspectiveCamera
      const halfV = (persp.fov * Math.PI) / 360
      const halfH = Math.atan(Math.tan(halfV) * persp.aspect)
      const dist = Math.min(half * 2.2, Math.max(30, (radius * 1.25) / Math.sin(Math.min(halfV, halfH))))
      const az = Math.atan2(camera.position.z - c.target.z, camera.position.x - c.target.x)
      const pitch = (50 * Math.PI) / 180
      const ty = hf.sampleHeight(cx, cz)
      c.target.set(cx, ty, cz)
      camera.position.set(cx + Math.cos(az) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, cz + Math.sin(az) * Math.cos(pitch) * dist)
      c.update()
    }

    // ---- per mode -----------------------------------------------------------------------------
    if (mode === 'orbit' && c) {
      // keep the target on the ground and the camera above it
      const tx = clampX(c.target.x)
      const tz = clampZ(c.target.z)
      const ground = hf.sampleHeight(tx, tz)
      const dy = ground - c.target.y
      c.target.set(tx, c.target.y + dy * Math.min(1, dt * 8), tz)
      camera.position.y += dy * Math.min(1, dt * 8)
      const floor = hf.sampleHeight(camera.position.x, camera.position.z) + 3
      if (camera.position.y < floor) camera.position.y = floor
      cameraRig.focus.x = c.target.x
      cameraRig.focus.y = c.target.y
      cameraRig.focus.z = c.target.z
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
    } else if (mode === 'chase' && roverLive.ready) {
      const back = 9
      const tx = roverLive.x - Math.cos(roverLive.yaw) * back
      const tz = roverLive.z - Math.sin(roverLive.yaw) * back
      const rg = hf.sampleHeight(roverLive.x, roverLive.z)
      const ty = Math.max(hf.sampleHeight(tx, tz) + 2.5, rg + 4.2)
      const s = 1 - Math.exp(-4 * dt)
      camera.position.x += (tx - camera.position.x) * s
      camera.position.y += (ty - camera.position.y) * s
      camera.position.z += (tz - camera.position.z) * s
      const floor = hf.sampleHeight(camera.position.x, camera.position.z) + 1.5
      if (camera.position.y < floor) camera.position.y = floor
      camera.lookAt(roverLive.x, rg + 1.0, roverLive.z)
      cameraRig.focus.x = roverLive.x
      cameraRig.focus.y = rg
      cameraRig.focus.z = roverLive.z
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={8}
      maxDistance={half * 2.2}
      maxPolarAngle={1.5}
      screenSpacePanning={false}
      rotateSpeed={0.7}
      panSpeed={0.9}
    />
  )
}
