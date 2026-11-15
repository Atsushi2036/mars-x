import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Heightfield } from '@/core/terrain/heightfield'
import { PathFollower } from '@/core/rover/path-follower'
import { roverPose } from '@/core/rover/pose'
import { roverLive, useRover } from '@/store/rover'

const WHEEL_R = 0.26
const WHEEL_X = 1.0
const WHEEL_Z = [-1.0, 0.0, 1.0]

/** NASA/JPL-Caltech Perseverance model (NASA 3D Resources), simplified and meshopt-compressed to ~1 MB: see public/models/CREDITS.txt. */
const MODEL_URL = `${import.meta.env.BASE_URL}models/perseverance.glb`
/** the model's nose points to +z in its own axes; the rover rig drives towards -z */
const MODEL_YAW = Math.PI

/** Loads the Perseverance GLB once; null while loading or if it fails (the procedural rover stays on screen). */
function usePerseveranceModel(): Object3D | null {
  const [model, setModel] = useState<Object3D | null>(null)
  useEffect(() => {
    let live = true
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    loader.load(
      MODEL_URL,
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (o instanceof Mesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        if (live) setModel(gltf.scene)
      },
      undefined,
      (e) => console.warn('Perseverance model failed to load, using the placeholder', e),
    )
    return () => {
      live = false
    }
  }, [])
  return model
}

/** Finds a gentle, central spot to park the rover (lowest slope within 160 m of the centre). */
export function findSpawn(hf: Heightfield): { x: number; z: number } {
  let best = { x: 0, z: 0 }
  let bestScore = Infinity
  for (let dz = -160; dz <= 160; dz += 8) {
    for (let dx = -160; dx <= 160; dx += 8) {
      const s = hf.slopeDegAt(dx, dz) + Math.hypot(dx, dz) * 0.01
      if (s < bestScore && hf.inBounds(dx, dz)) {
        bestScore = s
        best = { x: dx, z: dz }
      }
    }
  }
  return best
}

const _m = new Matrix4()
const _q = new Quaternion()
const _right = new Vector3()
const _up = new Vector3()
const _back = new Vector3()

/** Rover: the NASA Perseverance model once loaded; until then (or if it fails) a procedural placeholder (chassis, mast, RTG, six wheels). */
export function Rover({ hf }: { hf: Heightfield }) {
  const root = useRef<Group>(null)
  const wheels = useRef<Group[]>([])
  const follower = useRef<PathFollower | null>(null)
  const quat = useRef(new Quaternion())
  const first = useRef(true)
  const route = useRover((s) => s.route)
  const model = usePerseveranceModel()

  const mats = useMemo(
    () => ({
      body: new MeshStandardMaterial({ color: '#d5dbe3', roughness: 0.55, metalness: 0.15 }),
      dark: new MeshStandardMaterial({ color: '#2b323c', roughness: 0.7, metalness: 0.3 }),
      wheel: new MeshStandardMaterial({ color: '#1a1e25', roughness: 0.9, metalness: 0.05 }),
      hub: new MeshStandardMaterial({ color: '#8d97a5', roughness: 0.5, metalness: 0.6 }),
    }),
    [],
  )
  const wheelGeo = useMemo(() => new CylinderGeometry(WHEEL_R, WHEEL_R, 0.22, 20).rotateZ(Math.PI / 2), [])
  const hubGeo = useMemo(() => new CylinderGeometry(0.1, 0.1, 0.26, 10).rotateZ(Math.PI / 2), [])

  useEffect(() => {
    const spawn = findSpawn(hf)
    roverLive.x = spawn.x
    roverLive.z = spawn.z
    roverLive.yaw = Math.PI / 2
    roverLive.ready = true
  }, [hf])

  useEffect(() => {
    if (!route) {
      follower.current = null
      return
    }
    const wps = [{ x: roverLive.x, z: roverLive.z }, ...route.waypoints]
    follower.current = new PathFollower(wps, { speed: route.speed, loop: route.loop })
  }, [route])

  useFrame((_, dt) => {
    const g = root.current
    if (!g || !roverLive.ready) return
    const f = follower.current
    let moving = 0
    if (f) {
      const s = f.step(dt)
      roverLive.x = s.x
      roverLive.z = s.z
      roverLive.yaw = s.yaw
      moving = s.speed
      if (s.done) {
        follower.current = null
        useRover.getState().setStatus('arrived')
      }
    }
    const pose = roverPose(hf, roverLive.x, roverLive.z, roverLive.yaw)
    // basis -> quaternion (model: +x right, +y up, -z forward)
    _right.set(pose.right.x, pose.right.y, pose.right.z)
    _up.set(pose.up.x, pose.up.y, pose.up.z)
    _back.set(-pose.forward.x, -pose.forward.y, -pose.forward.z)
    _m.makeBasis(_right, _up, _back)
    _q.setFromRotationMatrix(_m)
    if (first.current) {
      quat.current.copy(_q)
      first.current = false
    } else quat.current.slerp(_q, 1 - Math.exp(-dt * 8))
    g.quaternion.copy(quat.current)
    g.position.set(pose.position.x, pose.position.y + WHEEL_R, pose.position.z)
    if (!model) for (const w of wheels.current) if (w) w.rotation.x -= (moving * dt) / WHEEL_R
  })

  const setWheel = (i: number) => (el: Group | null) => {
    if (el) wheels.current[i] = el
  }

  return (
    <group ref={root} name="rover">
      {model && <primitive object={model} position={[0, -WHEEL_R, 0]} rotation={[0, MODEL_YAW, 0]} />}
      <group visible={!model}>
      {/* chassis (warm electronics box) and deck */}
      <mesh castShadow material={mats.body} position={[0, 0.62, 0]}>
        <boxGeometry args={[1.5, 0.5, 2.3]} />
      </mesh>
      <mesh castShadow material={mats.dark} position={[0, 0.9, 0.05]}>
        <boxGeometry args={[1.62, 0.07, 2.4]} />
      </mesh>
      {/* mast + camera head */}
      <mesh castShadow material={mats.dark} position={[0.45, 1.5, -0.8]}>
        <cylinderGeometry args={[0.04, 0.04, 1.1, 8]} />
      </mesh>
      <mesh castShadow material={mats.body} position={[0.45, 2.1, -0.8]}>
        <boxGeometry args={[0.46, 0.18, 0.18]} />
      </mesh>
      {/* RTG at the rear */}
      <mesh castShadow material={mats.dark} position={[0, 0.72, 1.55]} rotation={[Math.PI / 2 - 0.25, 0, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.8, 12]} />
      </mesh>
      {/* rocker-bogie struts */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} castShadow material={mats.dark} position={[sx * 0.82, 0.5, 0]}>
          <boxGeometry args={[0.08, 0.1, 2.1]} />
        </mesh>
      ))}
      {/* six wheels */}
      {[-1, 1].flatMap((sx, si) =>
        WHEEL_Z.map((wz, wi) => (
          <group key={`${sx}${wz}`} position={[sx * WHEEL_X, 0, wz]} ref={setWheel(si * 3 + wi)}>
            <mesh castShadow geometry={wheelGeo} material={mats.wheel} />
            <mesh geometry={hubGeo} material={mats.hub} />
          </group>
        )),
      )}
      </group>
    </group>
  )
}
