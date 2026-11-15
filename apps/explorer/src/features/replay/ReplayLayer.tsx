import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, Vector3, type Group } from 'three'
import { cellToWorld } from '@/core/mission/geometry'
import { useApp } from '@/store/app'
import { cameraRig } from '@/store/camera'
import { useMission } from '@/store/mission'
import { useByo } from '../shared/byo-store'
import { useReplay } from './store'

const OK = '#5cc8e6'
const FAIL = '#f08a4b'
const AMBER = '#ffb81f'
const RED = '#ff5d4d'
const LIFT = 1.2
const RATE = 24 // steps per second

/** Draws the run being replayed on the terrain: path, current position, start and end. Renders nothing without a replay. */
export default function ReplayLayer() {
  const traj = useReplay((s) => s.traj)
  const episodeIndex = useReplay((s) => s.episodeIndex)
  const result = useByo((s) => s.run.result)
  const layers = useMission((s) => s.layers)
  const hf = useApp((s) => s.dataset?.heightfield)
  const cursor = useRef<Group>(null)
  const acc = useRef({ step: 0, last: 0 })

  const outcome = useMemo(() => result?.run.episodes.find((e) => e.index === episodeIndex)?.outcome ?? null, [result, episodeIndex])

  const pts = useMemo(() => {
    if (!traj || !layers || !hf) return null
    const g = layers.grid
    const n = traj.row.length
    const out: Vector3[] = new Array(n)
    for (let i = 0; i < n; i++) {
      const w = cellToWorld(g, traj.row[i]! * g.n + traj.col[i]!)
      out[i] = new Vector3(w.x, hf.sampleHeight(w.x, w.z) + LIFT, w.z)
    }
    return out
  }, [traj, layers, hf])

  useEffect(() => {
    if (pts && pts[0]) cameraRig.jumpTo = { x: pts[0].x, z: pts[0].z }
    acc.current = { step: 0, last: 0 }
  }, [pts])

  const done = useReplay((s) => Math.max(1, Math.floor(s.step) + 1))
  const donePts = useMemo(() => (pts ? pts.slice(0, Math.max(2, done)) : null), [pts, done])

  useFrame(({ camera }, dt) => {
    const st = useReplay.getState()
    if (!pts || !cursor.current) return
    if (st.playing) {
      const a = acc.current
      a.step = Math.min(pts.length - 1, (a.step || st.step) + dt * RATE)
      a.last += dt
      if (a.last > 0.066 || a.step >= pts.length - 1) {
        a.last = 0
        st.setStep(a.step)
      }
      if (a.step >= pts.length - 1) st.setPlaying(false)
    } else acc.current.step = st.step
    const s = Math.min(pts.length - 1, acc.current.step)
    const i = Math.floor(s)
    const p0 = pts[i]!
    const p1 = pts[Math.min(pts.length - 1, i + 1)]!
    const f = s - i
    cursor.current.position.set(p0.x + (p1.x - p0.x) * f, p0.y + (p1.y - p0.y) * f, p0.z + (p1.z - p0.z) * f)
    const d = camera.position.distanceTo(cursor.current.position)
    cursor.current.scale.setScalar(Math.max(1, d * 0.012))
  })

  if (!pts || !donePts || pts.length < 2) return null
  const failed = outcome !== null && outcome !== 'success'
  const start = pts[0]!
  const end = pts[pts.length - 1]!
  return (
    <group>
      <Line points={pts} color={failed ? FAIL : OK} lineWidth={2} transparent opacity={0.35} depthTest={false} renderOrder={5} />
      <Line points={donePts} color={failed ? FAIL : OK} lineWidth={4} depthTest={false} renderOrder={6} />
      <mesh position={start}>
        <sphereGeometry args={[1.1, 16, 12]} />
        <meshBasicMaterial color={AMBER} depthTest={false} />
      </mesh>
      <mesh position={end}>
        {failed ? <octahedronGeometry args={[1.5, 0]} /> : <boxGeometry args={[1.6, 1.6, 1.6]} />}
        <meshBasicMaterial color={failed ? RED : AMBER} depthTest={false} side={DoubleSide} />
      </mesh>
      <group ref={cursor}>
        <mesh renderOrder={7}>
          <sphereGeometry args={[0.9, 16, 12]} />
          <meshBasicMaterial color="#ffffff" depthTest={false} />
        </mesh>
      </group>
    </group>
  )
}
