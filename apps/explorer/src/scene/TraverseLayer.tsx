import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Color, InstancedMesh, Object3D, Sphere, Vector3 } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { Dataset } from '@/core/data/loader'
import { registerSlot } from '@/ui/slots'
import { useApp, type WaypointInfo } from '@/store/app'
import { parseTraverse, parseWaypoints, type TraverseData } from './traverse-data'
import { WaypointCard } from './WaypointCard'

const IVORY = new Color('#f3efe6')
const CASING = new Color('#0b0e14')
const AMBER = new Color('#ffb81f')
const LIFT = 0.9
/** marker half-size as a fraction of the distance to the camera (constant size on screen) */
const MARKER_SCALE = 0.0085

// the details card is plain HTML over the canvas; it renders nothing until a waypoint is picked
registerSlot({ id: 'scene.waypoint-card', slot: 'overlay', component: WaypointCard })

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

interface Loaded {
  traverse: TraverseData
  waypoints: WaypointInfo[]
}

const cache = new Map<string, Promise<Loaded | null>>()
function loadTraverse(ds: Dataset): Promise<Loaded | null> {
  let p = cache.get(ds.base)
  if (!p) {
    const t = ds.manifest.layers.find((l) => l.id === 'traverse')
    const w = ds.manifest.layers.find((l) => l.id === 'waypoints')
    p =
      t && w
        ? Promise.all([fetchJson(`${ds.base}/${t.path}`), fetchJson(`${ds.base}/${w.path}`)]).then(([a, b]) => ({
            traverse: parseTraverse(a),
            waypoints: parseWaypoints(b),
          }))
        : Promise.resolve(null)
    p.catch(() => cache.delete(ds.base))
    cache.set(ds.base, p)
  }
  return p
}

/** The real Perseverance drive tracks (one polyline per drive) draped on the DEM, plus a marker at every recorded waypoint. */
export function TraverseLayer({ ds }: { ds: Dataset }) {
  const on = useApp((s) => s.showTraverse)
  const [data, setData] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!on || data) return
    let live = true
    loadTraverse(ds)
      .then((d) => live && setData(d))
      .catch((e: unknown) => console.warn('traverse failed', e))
    return () => {
      live = false
    }
  }, [on, ds, data])
  if (!on || !data) return null
  return <TraverseDraw ds={ds} data={data} />
}

function TraverseDraw({ ds, data }: { ds: Dataset; data: Loaded }) {
  const hf = ds.heightfield
  const size = useThree((s) => s.size)
  const selected = useApp((s) => s.selectedWaypoint)

  const lines = useMemo(() => {
    const mk = (width: number, color: Color, order: number) => {
      const mat = new LineMaterial({
        color: color.getHex(),
        linewidth: width,
        worldUnits: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        toneMapped: false,
      })
      return { mat, order }
    }
    const casing = mk(5, CASING, 6)
    const core = mk(2.4, IVORY, 7)
    const geoms: LineGeometry[] = []
    const objs: Line2[] = []
    for (const l of data.traverse.lines) {
      const n = l.xz.length / 2
      if (n < 2) continue
      const pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const x = l.xz[2 * i]!
        const z = l.xz[2 * i + 1]!
        pos[3 * i] = x
        pos[3 * i + 1] = hf.sampleHeight(x, z) + LIFT
        pos[3 * i + 2] = z
      }
      const g = new LineGeometry()
      g.setPositions(pos)
      geoms.push(g)
      for (const m of [casing, core]) {
        const o = new Line2(g, m.mat)
        o.renderOrder = m.order
        o.frustumCulled = false
        objs.push(o)
      }
    }
    return { objs, mats: [casing.mat, core.mat], geoms }
  }, [data, hf])
  useEffect(
    () => () => {
      lines.geoms.forEach((g) => g.dispose())
      lines.mats.forEach((m) => m.dispose())
    },
    [lines],
  )
  useEffect(() => {
    for (const m of lines.mats) m.resolution.set(size.width, size.height)
  }, [lines, size])

  return (
    <>
      {lines.objs.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
      <Waypoints ds={ds} points={data.waypoints} selected={selected} />
    </>
  )
}

function Waypoints({ ds, points, selected }: { ds: Dataset; points: WaypointInfo[]; selected: WaypointInfo | null }) {
  const hf = ds.heightfield
  const core = useRef<InstancedMesh>(null)
  const ring = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const ys = useMemo(() => points.map((p) => hf.sampleHeight(p.x, p.z) + LIFT + 0.6), [points, hf])
  const tmp = useMemo(() => new Vector3(), [])

  useEffect(() => {
    for (const m of [core.current, ring.current]) {
      if (!m) continue
      // instances are rescaled every frame: never cull or reject by an initial bounding sphere
      m.boundingSphere = new Sphere(new Vector3(0, 0, 0), 20000)
      m.frustumCulled = false
    }
    const c = core.current
    if (c) {
      const col = new Color()
      points.forEach((p, i) => c.setColorAt(i, col.copy(p === selected ? AMBER : IVORY)))
      if (c.instanceColor) c.instanceColor.needsUpdate = true
    }
  }, [points, selected])

  useFrame(({ camera }) => {
    const c = core.current
    const r = ring.current
    if (!c || !r) return
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      tmp.set(p.x, ys[i]!, p.z)
      const d = Math.max(4, camera.position.distanceTo(tmp))
      const s = d * MARKER_SCALE * (p === selected ? 1.5 : 1)
      dummy.position.copy(tmp)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      c.setMatrixAt(i, dummy.matrix)
      dummy.scale.setScalar(s * 1.55)
      dummy.updateMatrix()
      r.setMatrixAt(i, dummy.matrix)
    }
    c.instanceMatrix.needsUpdate = true
    r.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={ring} args={[undefined, undefined, points.length]} renderOrder={8} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={CASING} toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={core}
        args={[undefined, undefined, points.length]}
        renderOrder={9}
        frustumCulled={false}
        onClick={(e) => {
          e.stopPropagation()
          if (e.instanceId !== undefined) useApp.getState().setSelectedWaypoint(points[e.instanceId] ?? null)
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  )
}
