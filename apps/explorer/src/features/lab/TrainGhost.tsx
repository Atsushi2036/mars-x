import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import { Vector3, type Group } from 'three'
import { useApp } from '@/store/app'
import { useMission } from '@/store/mission'
import { learnerCellToWorld } from './ghost-map'
import { useTrainGhost } from './train-ghost'
import { frameAt, stepMsFor } from './watch'

const LIFT = 1.0
const TONE: Record<string, string> = { gain: '#5fd08a', loss: '#ff8a80', hazard: '#ff6b5e', goal: '#5fd08a', timeout: '#9aa5b6' }

/**
 * A translucent "ghost rover" that replays the last traced training episode over the real terrain, with the same
 * floating +/- as the 2D map. Renders nothing unless "Show in 3D" is on and an episode has been published.
 * All per-frame work goes through refs; React state only changes a few times per second.
 */
export default function TrainGhost() {
  const enabled = useTrainGhost((s) => s.enabled)
  const sample = useTrainGhost((s) => s.sample)
  const crop = useTrainGhost((s) => s.crop)
  const layers = useMission((s) => s.layers)
  const hf = useApp((s) => s.dataset?.heightfield)
  const ghost = useRef<Group>(null)
  const label = useRef<HTMLDivElement>(null)
  // steps played of the current sample, reported a few times per second (the sample it belongs to travels with it)
  const [progress, setProgress] = useState<{ of: unknown; steps: number }>({ of: null, steps: 0 })
  const reached = progress.of === sample ? progress.steps : 0
  const lastReport = useRef(0)

  const pts = useMemo(() => {
    if (!sample || !crop || !layers || !hf) return null
    const cells = [sample.start, ...Array.from(sample.cells)]
    // one point per step (index = steps played), including repeats when a move bumped
    return cells.map((c) => {
      const w = learnerCellToWorld(crop, layers.grid, c)
      return new Vector3(w.x, hf.sampleHeight(w.x, w.z) + LIFT, w.z)
    })
  }, [sample, crop, layers, hf])

  useFrame(({ camera }) => {
    const st = useTrainGhost.getState()
    const g = ghost.current
    if (!g || !st.sample || !pts) return
    const s = st.sample
    const stepMs = st.reducedMotion ? 1 : stepMsFor(st.speed, s.cells.length)
    const elapsed = st.reducedMotion ? s.cells.length * stepMs + (performance.now() - st.startedAt) : performance.now() - st.startedAt
    const f = frameAt(s, elapsed, stepMs, { endHoldMs: st.speed === 'slow' ? 1100 : 450, floatMs: st.speed === 'slow' ? 700 : 350 })
    const idx = Math.min(pts.length - 1, f.step)
    const p = pts[idx]!
    const q = pts[Math.min(pts.length - 1, idx + 1)]!
    g.position.copy(p)
    if (!q.equals(p)) g.rotation.y = Math.atan2(q.x - p.x, q.z - p.z)
    g.scale.setScalar(Math.max(1, camera.position.distanceTo(p) * 0.016))
    const now = performance.now()
    if (now - lastReport.current > 160) {
      lastReport.current = now
      setProgress({ of: s, steps: idx + 1 })
    }
    const el = label.current
    if (el) {
      const fl = f.floaters[f.floaters.length - 1]
      if (f.banner && f.flash && f.flash.age < 1) {
        el.textContent = f.banner
        el.style.color = TONE[f.flash.tone]!
        el.style.opacity = '1'
        el.style.fontSize = '15px'
      } else if (fl && !st.reducedMotion) {
        el.textContent = fl.text
        el.style.color = TONE[fl.tone]!
        el.style.opacity = String(1 - fl.age)
        el.style.fontSize = '13px'
      } else el.style.opacity = '0'
    }
  })

  if (!enabled || !sample || !pts || pts.length < 2) return null
  const distinct = (xs: Vector3[]) => xs.filter((v, i) => i === 0 || !v.equals(xs[i - 1]!))
  const full = distinct(pts)
  const done = distinct(pts.slice(0, Math.max(1, reached)))
  return (
    <group>
      <Line points={full} color="#ffb81f" lineWidth={2} transparent opacity={0.3} depthTest={false} renderOrder={5} />
      {done.length > 1 && <Line points={done} color="#ffb81f" lineWidth={4} depthTest={false} renderOrder={6} />}
      <group ref={ghost}>
        {/* ghost rover: translucent body, mast and six wheels */}
        <mesh position={[0, 0.9, 0]} renderOrder={7}>
          <boxGeometry args={[1.8, 0.8, 2.8]} />
          <meshBasicMaterial color="#ffb81f" transparent opacity={0.8} depthTest={false} />
        </mesh>
        <mesh position={[0.4, 1.9, 0.9]} renderOrder={7}>
          <boxGeometry args={[0.35, 1.4, 0.35]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} depthTest={false} />
        </mesh>
        {[-1, 1].flatMap((sx) => [-1, 0, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * 1.05, 0.4, sz * 1.0]} rotation={[0, 0, Math.PI / 2]} renderOrder={7}>
            <cylinderGeometry args={[0.4, 0.4, 0.3, 12]} />
            <meshBasicMaterial color="#e8ecf2" transparent opacity={0.5} depthTest={false} />
          </mesh>
        )))}
        <Html position={[0, 3.4, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={label} aria-hidden="true" className="select-none whitespace-nowrap rounded-full bg-black/60 px-2.5 py-0.5 font-semibold tabular-nums" style={{ opacity: 0 }} />
        </Html>
      </group>
    </group>
  )
}
