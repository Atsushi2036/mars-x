import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector2, type Group } from 'three'
import type { Dataset } from '@/core/data/loader'
import { raycastTerrain, worldToCell, type XZ } from '@/core/mission/geometry'
import { marswalkReport } from '@/core/mission/marswalk'
import { useApp } from '@/store/app'
import { useMission } from '@/store/mission'

const CASING = new Color('#f3efe6')
const UNSAFE = new Color('#ff5d4d')
const VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'].map((c) => new Color(c))

/** viridis-like colour for a slope in degrees (0..30+). */
function slopeColor(deg: number, out: Color): Color {
  const t = Math.min(1, Math.max(0, deg / 30)) * (VIRIDIS.length - 1)
  const i = Math.min(VIRIDIS.length - 2, Math.floor(t))
  return out.copy(VIRIDIS[i]!).lerp(VIRIDIS[i + 1]!, t - i)
}

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

/** Flat ribbon draped over the terrain, coloured by the slope under each vertex. */
function buildRibbon(path: XZ[], hf: Dataset['heightfield'], slopeAt: (x: number, z: number) => number, halfWidth: number, flat?: Color, lift = 0.45) {
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
      if (flat) c.copy(flat)
      else slopeColor(slopeAt(p.x, p.z), c)
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

/** Origin/destination markers, click-to-place on the terrain, and the planned route. */
export function MissionLayer({ ds }: { ds: Dataset }) {
  const hf = ds.heightfield
  const { camera, gl } = useThree()
  const origin = useMission((s) => s.origin)
  const destination = useMission((s) => s.destination)
  const outcomes = useMission((s) => s.outcomes)
  const profile = useMission((s) => s.profile)
  const layers = useMission((s) => s.layers)
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

  const ribbon = useMemo(() => {
    if (!outcome || outcome.status !== 'ok' || !layers) return null
    const slopeAt = (x: number, z: number) => {
      const c = worldToCell(layers.grid, x, z)
      return c < 0 ? 0 : layers.slope[c]!
    }
    return {
      core: buildRibbon(outcome.path, hf, slopeAt, 2.0, undefined, 0.6),
      casing: buildRibbon(outcome.path, hf, slopeAt, 3.3, CASING, 0.5),
    }
  }, [outcome, layers, hf])
  useEffect(
    () => () => {
      ribbon?.core.dispose()
      ribbon?.casing.dispose()
    },
    [ribbon],
  )

  // Marswalk shelter rule: the part of the route that is more than the shelter window from the start is outlined in red
  const unsafe = useMemo(() => {
    if (profile !== 'astronaut' || !outcome || outcome.status !== 'ok') return null
    const r = marswalkReport(outcome.path, (x, z) => hf.sampleHeight(x, z), walk).shelter
    if (r.unsafePath.length < 2 || !r.boundary) return null
    return { geo: buildRibbon(r.unsafePath, hf, () => 0, 4.8, UNSAFE, 0.35), boundary: r.boundary }
  }, [profile, outcome, walk, hf])
  useEffect(() => () => unsafe?.geo.dispose(), [unsafe])

  const mat = useMemo(
    () => new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }),
    [],
  )
  const meshRef = useRef<Mesh>(null)

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
      {ribbon && (
        <>
          <mesh geometry={ribbon.casing} material={mat} frustumCulled={false} renderOrder={4} />
          <mesh ref={meshRef} geometry={ribbon.core} material={mat} frustumCulled={false} renderOrder={5} />
        </>
      )}
    </>
  )
}
