import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { Vector3 } from 'three'
import type { Heightfield } from '@/core/terrain/heightfield'
import { watchCtx } from '@/store/watch'

const AMBER = '#ffb81f'
const DARK = '#0b0e14'
const WARN = '#ff7a45'
const LIFT = 1.4
const REFRESH_S = 0.15

/**
 * The path the AI policy has driven so far, in amber with a dark casing (the A* route stays cyan behind it, for comparison),
 * and a marker where it bumped into something or ran out of road. Rebuilt at ~7 Hz while a live drive runs; nothing otherwise.
 */
export function DriveTrail({ hf }: { hf: Heightfield }) {
  const [pts, setPts] = useState<Vector3[] | null>(null)
  const [marks, setMarks] = useState<Vector3[]>([])
  const seen = useRef('')
  const clock = useRef(0)

  useFrame((_, dt) => {
    const c = watchCtx.current
    if (!c || c.kind !== 'run' || !c.live) {
      if (seen.current !== '') {
        seen.current = ''
        setPts(null)
        setMarks([])
      }
      return
    }
    clock.current += dt
    if (clock.current < REFRESH_S) return
    clock.current = 0
    const upto = Math.min(c.live.filled - 1, Math.floor(c.step) + 1)
    const evs = c.live.track.events.filter((e) => e.at <= upto && e.kind !== 'end').length
    const key = `${upto}/${evs}`
    if (key === seen.current) return
    seen.current = key
    if (upto < 1) return
    const p: Vector3[] = []
    // thin out long trails: every point up to 600, then every other
    const stride = upto > 600 ? 2 : 1
    for (let i = 0; i <= upto; i += stride) p.push(new Vector3(c.x[i]!, hf.sampleHeight(c.x[i]!, c.z[i]!) + LIFT, c.z[i]!))
    const last = new Vector3(c.x[upto]!, hf.sampleHeight(c.x[upto]!, c.z[upto]!) + LIFT, c.z[upto]!)
    if (p.length < 2 || !p[p.length - 1]!.equals(last)) p.push(last)
    setPts(p)
    setMarks(
      c.live.track.events
        .filter((e) => e.at <= upto && e.kind !== 'end')
        .slice(0, 40)
        .map((e) => new Vector3(c.x[e.at]!, hf.sampleHeight(c.x[e.at]!, c.z[e.at]!) + LIFT + 0.6, c.z[e.at]!)),
    )
  })

  if (!pts || pts.length < 2) return null
  return (
    <group renderOrder={6}>
      <Line points={pts} color={DARK} lineWidth={8} transparent opacity={0.7} polygonOffset polygonOffsetFactor={-5} polygonOffsetUnits={-5} />
      <Line points={pts} color={AMBER} lineWidth={4.5} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
      {marks.map((m, i) => (
        <mesh key={i} position={m}>
          <sphereGeometry args={[1.1, 10, 8]} />
          <meshBasicMaterial color={WARN} />
        </mesh>
      ))}
    </group>
  )
}
