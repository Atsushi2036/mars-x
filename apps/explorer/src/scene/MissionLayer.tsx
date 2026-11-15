import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, MeshBasicMaterial, Raycaster, Vector2, Vector3, type Group } from 'three'
import type { Dataset } from '@/core/data/loader'
import { raycastTerrain, type XZ } from '@/core/mission/geometry'
import { marswalkReport } from '@/core/mission/marswalk'
import { useApp } from '@/store/app'
import { useMission } from '@/store/mission'
import { usePlayback } from '@/store/playback'

const UNSAFE = new Color('#ff5d4d')
/** the planner's route: cyan core on a dark casing (screen-space width, so it stays readable from 2 km up) */
const ROUTE_CORE = '#5cc8e6'
const ROUTE_CASING = '#0b0e14'
/** stretch already driven during Watch: quieter, so what is left stands out */
const ROUTE_DONE = '#4f7480'
/** metres above the ground: enough to clear the render mesh without floating (depth-tested, so models hide the line) */
const ROUTE_LIFT = 0.25
const AMBER = '#ffb81f'
const DRAW_MS = 700

function Marker({ at, kind, hf }: { at: XZ; kind: 'origin' | 'destination'; hf: Dataset['heightfield'] }) {
  const g = useRef<Group>(null)
  useFrame(({ camera }) => {
    const m = g.current
    if (!m) return
    const y = hf.sampleHeight(at.x, at.z)
    m.position.set(at.x, y, at.z)
    const d = Math.hypot(camera.position.x - at.x, camera.position.y - y, camera.position.z - at.z)
    m.scale.setScalar(Math.max(1, d * 0.02)) // constant apparent size
  })
  return (
    <group ref={g}>
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 6, 8]} />
        <meshBasicMaterial color="#ffb81f" />
      </mesh>
      {kind === 'origin' ? (
        <mesh position={[0, 6.4, 0]}>
          <sphereGeometry args={[0.55, 16, 12]} />
          <meshBasicMaterial color="#ffb81f" />
        </mesh>
      ) : (
        <mesh position={[0, 6.6, 0]}>
          <octahedronGeometry args={[0.8, 0]} />
          <meshBasicMaterial color="#ffb81f" />
        </mesh>
      )}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 1.0, 32]} />
        <meshBasicMaterial color="#ffb81f" side={DoubleSide} />
      </mesh>
    </group>
  )
}

/** Red post where the shelter window runs out (constant size on screen). */
function ShelterLimitMarker({ at, hf }: { at: XZ; hf: Dataset['heightfield'] }) {
  const g = useRef<Group>(null)
  useFrame(({ camera }) => {
    const m = g.current
    if (!m) return
    const y = hf.sampleHeight(at.x, at.z)
    m.position.set(at.x, y, at.z)
    const d = Math.hypot(camera.position.x - at.x, camera.position.y - y, camera.position.z - at.z)
    m.scale.setScalar(Math.max(1, d * 0.02))
  })
  return (
    <group ref={g}>
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 5, 8]} />
        <meshBasicMaterial color="#ff5d4d" />
      </mesh>
      <mesh position={[0, 5.4, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[1.1, 1.1, 0.2]} />
        <meshBasicMaterial color="#ff5d4d" />
      </mesh>
    </group>
  )
}

/** Flat ribbon draped over the terrain in one colour (used for the shelter-limit stretch). */
function buildRibbon(path: XZ[], hf: Dataset['heightfield'], halfWidth: number, flat: Color, lift = 0.45) {
  const n = path.length
  const pos = new Float32Array(n * 2 * 3)
  const col = new Float32Array(n * 2 * 3)
  const c = new Color()
  for (let i = 0; i < n; i++) {
    const p = path[i]!
    const a = path[Math.max(0, i - 1)]!
    const b = path[Math.min(n - 1, i + 1)]!
    let dx = b.x - a.x
    let dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    dx /= l
    dz /= l
    const nx = -dz * halfWidth
    const nz = dx * halfWidth
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? -1 : 1
      const x = p.x + nx * sign
      const z = p.z + nz * sign
      const k = (i * 2 + s) * 3
      pos[k] = x
      pos[k + 1] = hf.sampleHeight(x, z) + lift
      pos[k + 2] = z
      c.copy(flat)
      col[k] = c.r
      col[k + 1] = c.g
      col[k + 2] = c.b
    }
  }
  const idx: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('color', new BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}


const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The planned route as screen-space fat lines (always readable, whatever the zoom): a dark casing under a cyan core.
 * Appearing draws it from the origin to the goal in 700 ms with a leading amber dot; reduced motion shows it at once.
 * The reveal runs on refs in the frame loop (no React state per frame).
 */
function RouteLine({ path, hf }: { path: XZ[]; hf: Dataset['heightfield'] }) {
  const pts = useMemo(() => path.map((p) => new Vector3(p.x, hf.sampleHeight(p.x, p.z) + ROUTE_LIFT, p.z)), [path, hf])
  const cum = useMemo(() => {
    const c = [0]
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
    return c
  }, [pts])
  const casing = useRef<{ geometry: { instanceCount: number } } | null>(null)
  const core = useRef<{ geometry: { instanceCount: number } } | null>(null)
  const done = useRef<{ geometry: { instanceCount: number } } | null>(null)
  const head = useRef<Group>(null)
  const t0 = useRef(0)
  const skip = useRef(false)
  useEffect(() => {
    t0.current = performance.now()
    skip.current = reducedMotion()
  }, [pts])
  useFrame(({ camera }) => {
    const n = pts.length - 1
    if (n < 1) return
    const k = skip.current ? 1 : easeOut(Math.min(1, (performance.now() - t0.current) / DRAW_MS))
    const segs = k >= 1 ? n : Math.max(1, Math.ceil(n * k))
    if (casing.current) casing.current.geometry.instanceCount = segs
    if (core.current) core.current.geometry.instanceCount = segs
    if (done.current) {
      // Watch: how far along the route the agent is (playback time / duration), as a segment count
      const pb = usePlayback.getState()
      const frac = pb.source === 'route' && pb.duration > 0 ? Math.min(1, pb.t / pb.duration) : 0
      let idx = 0
      const target = frac * (cum[n] ?? 0)
      while (idx < n && (cum[idx + 1] ?? 0) <= target) idx++
      done.current.geometry.instanceCount = Math.min(segs, idx)
    }
    const h = head.current
    if (h) {
      h.visible = k < 1
      if (k < 1) {
        const p = pts[Math.min(n, Math.floor(n * k))]!
        h.position.copy(p)
        h.scale.setScalar(Math.max(1, camera.position.distanceTo(p) * 0.012))
      }
    }
  })
  return (
    <>
      <Line ref={casing as never} points={pts} color={ROUTE_CASING} lineWidth={7.5} transparent opacity={0.55} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} renderOrder={4} />
      <Line ref={core as never} points={pts} color={ROUTE_CORE} lineWidth={4.5} transparent opacity={1} polygonOffset polygonOffsetFactor={-5} polygonOffsetUnits={-5} renderOrder={5} />
      <Line ref={done as never} points={pts} color={ROUTE_DONE} lineWidth={4.5} transparent opacity={1} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} renderOrder={6} />
      <group ref={head} visible={false} renderOrder={6}>
        <mesh>
          <sphereGeometry args={[1.6, 16, 12]} />
          <meshBasicMaterial color={AMBER} depthTest={false} toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[3.2, 16, 12]} />
          <meshBasicMaterial color={AMBER} transparent opacity={0.3} depthTest={false} toneMapped={false} />
        </mesh>
      </group>
    </>
  )
}

/** Origin/destination markers, click-to-place on the terrain, and the planned route. */
export function MissionLayer({ ds }: { ds: Dataset }) {
  const hf = ds.heightfield
  const { camera, gl } = useThree()
  const origin = useMission((s) => s.origin)
  const destination = useMission((s) => s.destination)
  const outcomes = useMission((s) => s.outcomes)
  const profile = useMission((s) => s.profile)
  const walk = useMission((s) => s.walk)
  const outcome = outcomes[profile]
  const ray = useMemo(() => new Raycaster(), [])

  // click (not drag) on the terrain places the next endpoint while in Mission mode
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number; t: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() }
    }
    const onUp = (e: PointerEvent) => {
      const d = down
      down = null
      if (!d || e.button !== 0) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 450) return
      if (useApp.getState().mode !== 'mission') return
      const r = el.getBoundingClientRect()
      ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const hit = raycastTerrain(hf, ray.ray.origin, ray.ray.direction)
      if (hit) useMission.getState().place(ds, { x: hit.x, z: hit.z })
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [gl, camera, ray, hf, ds])

  // Marswalk shelter rule: the part of the route that is more than the shelter window from the start is outlined in red
  const unsafe = useMemo(() => {
    if (profile !== 'astronaut' || !outcome || outcome.status !== 'ok') return null
    const r = marswalkReport(outcome.path, (x, z) => hf.sampleHeight(x, z), walk).shelter
    if (r.unsafePath.length < 2 || !r.boundary) return null
    return { geo: buildRibbon(r.unsafePath, hf, 4.8, UNSAFE, 0.35), boundary: r.boundary }
  }, [profile, outcome, walk, hf])
  useEffect(() => () => unsafe?.geo.dispose(), [unsafe])

  const mat = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
    [],
  )

  return (
    <>
      {origin && <Marker at={origin} kind="origin" hf={hf} />}
      {destination && <Marker at={destination} kind="destination" hf={hf} />}
      {unsafe && (
        <>
          <mesh geometry={unsafe.geo} material={mat} frustumCulled={false} renderOrder={3} />
          <ShelterLimitMarker at={unsafe.boundary} hf={hf} />
        </>
      )}
      {outcome && outcome.status === 'ok' && <RouteLine path={outcome.path} hf={hf} />}
    </>
  )
}
