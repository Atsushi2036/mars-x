import { useEffect, useMemo, useRef, useState } from 'react'
import type { Heightfield } from '@/core/terrain/heightfield'
import { useApp } from '@/store/app'
import { agentLive, cameraRig, flyTo, useCamera, zoomBy } from '@/store/camera'
import { useMission } from '@/store/mission'
import { roverLive } from '@/store/rover'
import { cn } from '@/lib/utils'
import { X } from '@/ui/icons'
import { coneWedge, miniFrame, miniToWorld, worldToMini } from './minimap-math'
import { flashNotice } from './store'

const GRID = 128
const FRAME_MS = 66 // 15 Hz
const PLANNER = '#5cc8e6'
const AMBER = '#ffb81f'

/** draw cost probe (ms total / draws), read by the capture harness */
export const miniPerf = { ms: 0, n: 0 }

const baseCache = new WeakMap<Heightfield, HTMLCanvasElement>()

/** Hillshade of the terrain (Lambert, light from the north-west), 128x128, computed once from the heights already in memory. */
function hillshade(hf: Heightfield): HTMLCanvasElement {
  const hit = baseCache.get(hf)
  if (hit) return hit
  const cv = document.createElement('canvas')
  cv.width = cv.height = GRID
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(GRID, GRID)
  const e = hf.extent
  const f = miniFrame(e, GRID)
  const hs: number[] = new Array(GRID * GRID)
  let lo = Infinity
  let hi = -Infinity
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      const h = hf.sampleHeight(e.xMin + (c + 0.5 - f.ox) * f.mpp, e.zMin + (r + 0.5 - f.oy) * f.mpp)
      hs[r * GRID + c] = h
      if (h < lo) lo = h
      if (h > hi) hi = h
    }
  const lx = -0.5
  const lz = -0.5
  const ly = 0.75
  const ln = Math.hypot(lx, ly, lz)
  const k = 2.2 // vertical exaggeration so low relief still reads
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      const at = (rr: number, cc: number) => hs[Math.min(GRID - 1, Math.max(0, rr)) * GRID + Math.min(GRID - 1, Math.max(0, cc))]!
      const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * f.mpp)
      const dz = (at(r + 1, c) - at(r - 1, c)) / (2 * f.mpp)
      const nx = -dx * k
      const nz = -dz * k
      const lam = Math.max(0, (nx * lx + ly + nz * lz) / (Math.hypot(nx, 1, nz) * ln))
      const t = (hs[r * GRID + c]! - lo) / Math.max(1, hi - lo)
      const shade = 0.35 + 0.75 * lam
      const i = (r * GRID + c) * 4
      img.data[i] = Math.min(255, (150 + 60 * t) * shade)
      img.data[i + 1] = Math.min(255, (112 + 50 * t) * shade)
      img.data[i + 2] = Math.min(255, (86 + 40 * t) * shade)
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  baseCache.set(hf, cv)
  return cv
}

function MiniCanvas({ size }: { size: number }) {
  const hf = useApp((s) => s.dataset?.heightfield)
  const ref = useRef<HTMLCanvasElement>(null)
  const ext = hf?.extent
  const frame = useMemo(() => (ext ? miniFrame(ext, size) : null), [ext, size])
  const dragging = useRef(false)

  useEffect(() => {
    const cv = ref.current
    if (!cv || !hf || !frame) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(size * dpr)
    cv.height = Math.round(size * dpr)
    const ctx = cv.getContext('2d')!
    const base = hillshade(hf)
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < FRAME_MS || document.hidden) return
      last = t
      const t0 = performance.now()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(base, 0, 0, size, size)
      const m = useMission.getState()
      const out = m.outcomes[m.profile]
      if (out && out.status === 'ok') {
        ctx.beginPath()
        out.path.forEach((p, i) => {
          const q = worldToMini(p.x, p.z, frame)
          if (i) ctx.lineTo(q.x, q.y)
          else ctx.moveTo(q.x, q.y)
        })
        ctx.lineJoin = 'round'
        ctx.lineWidth = 4
        ctx.strokeStyle = 'rgba(11,14,20,.75)'
        ctx.stroke()
        ctx.lineWidth = 2
        ctx.strokeStyle = PLANNER
        ctx.stroke()
      }
      if (m.origin) {
        const q = worldToMini(m.origin.x, m.origin.z, frame)
        ctx.fillStyle = AMBER
        ctx.strokeStyle = '#0b0e14'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(q.x, q.y - 5)
        ctx.lineTo(q.x + 5, q.y)
        ctx.lineTo(q.x, q.y + 5)
        ctx.lineTo(q.x - 5, q.y)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      if (m.destination) {
        const q = worldToMini(m.destination.x, m.destination.z, frame)
        ctx.fillStyle = AMBER
        ctx.strokeStyle = '#0b0e14'
        ctx.lineWidth = 1.5
        ctx.fillRect(q.x - 4, q.y - 4, 8, 8)
        ctx.strokeRect(q.x - 4, q.y - 4, 8, 8)
      }
      // camera cone
      const p = cameraRig.pose
      const c = worldToMini(p.x, p.z, frame)
      const w = coneWedge(c, p.yaw, p.fovDeg, size * 0.2)
      ctx.beginPath()
      ctx.moveTo(c.x, c.y)
      ctx.lineTo(w.left.x, w.left.y)
      ctx.lineTo(w.right.x, w.right.y)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255,255,255,.32)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.85)'
      ctx.lineWidth = 1.25
      ctx.stroke()
      // agent: amber dot, pulsing 1.6 s
      const a = agentLive.ready ? agentLive : roverLive
      const q = worldToMini(a.x, a.z, frame)
      const pulse = 0.5 + 0.5 * Math.sin((t / 1600) * Math.PI * 2)
      ctx.beginPath()
      ctx.arc(q.x, q.y, 6 + 3 * pulse, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,184,31,${0.35 - 0.2 * pulse})`
      ctx.fill()
      ctx.beginPath()
      ctx.arc(q.x, q.y, 3.6, 0, Math.PI * 2)
      ctx.fillStyle = AMBER
      ctx.fill()
      ctx.strokeStyle = '#0b0e14'
      ctx.lineWidth = 1.5
      ctx.stroke()
      miniPerf.ms += performance.now() - t0
      miniPerf.n++
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [hf, frame, size])

  if (!hf || !ext || !frame) return null
  const go = (e: React.PointerEvent, ms: number) => {
    const r = e.currentTarget.getBoundingClientRect()
    const w = miniToWorld(((e.clientX - r.left) / r.width) * size, ((e.clientY - r.top) / r.height) * size, frame, ext)
    const mode = useCamera.getState().mode
    if (mode === 'orbit') flyTo({ x: w.x, z: w.z }, ms)
    else if (mode === 'fpv') flyTo({ x: w.x, z: w.z }, 0)
    else if (ms > 0) flashNotice('Follow tracks the rover. Press 1 for Orbit to move the view.')
  }
  const nudge = (dx: number, dz: number) => {
    if (useCamera.getState().mode !== 'orbit') return
    flyTo({ x: cameraRig.focus.x + dx, z: cameraRig.focus.z + dz }, 250)
  }
  return (
    <canvas
      ref={ref}
      role="application"
      aria-label="Minimap. Click or drag to move the camera, arrow keys nudge it"
      tabIndex={0}
      style={{ width: size, height: size }}
      className="pointer-events-auto block touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
        go(e, 600)
      }}
      onPointerMove={(e) => dragging.current && go(e, 140)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onWheel={(e) => {
        if (useCamera.getState().mode === 'orbit') zoomBy(e.deltaY > 0 ? 1 / 0.75 : 0.75)
      }}
      onKeyDown={(e) => {
        const d = 60
        if (e.key === 'ArrowUp') nudge(0, -d)
        else if (e.key === 'ArrowDown') nudge(0, d)
        else if (e.key === 'ArrowLeft') nudge(-d, 0)
        else if (e.key === 'ArrowRight') nudge(d, 0)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    />
  )
}

/** Clickable minimap, north up. Desktop: always there. Phones: a 48 px button that opens a 160 px popover. */
export function Minimap({ compact }: { compact: boolean }) {
  const [open, setOpen] = useState(false)
  const size = compact ? 160 : window.innerWidth < 1280 ? 128 : 168
  if (compact) {
    return (
      <div className="pointer-events-none">
        {open && (
          <div className="glass pointer-events-auto relative mb-2 rounded-2xl p-1.5">
            <MiniCanvas size={size} />
            <button
              type="button"
              aria-label="Close minimap"
              onClick={() => setOpen(false)}
              className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border border-border bg-card text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {!open && (
          <button
            type="button"
            aria-label="Open minimap"
            onClick={() => setOpen(true)}
            className={cn('glass pointer-events-auto grid size-12 place-items-center overflow-hidden rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            <MiniThumb />
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="glass pointer-events-auto rounded-2xl p-1.5">
      <MiniCanvas size={size} />
    </div>
  )
}

/** Static hillshade thumbnail for the collapsed phone button. */
function MiniThumb() {
  const hf = useApp((s) => s.dataset?.heightfield)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!hf || !ref.current) return
    ref.current.getContext('2d')?.drawImage(hillshade(hf), 0, 0, 38, 38)
  }, [hf])
  return <canvas ref={ref} width={38} height={38} className="size-[38px] rounded-md" aria-hidden="true" />
}
