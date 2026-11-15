import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { MeshStandardMaterial, type Group } from 'three'
import type { Heightfield } from '@/core/terrain/heightfield'
import { useMission } from '@/store/mission'
import { roverLive } from '@/store/rover'

/** Stride cadence cap (steps per second): at 16x playback the legs must not strobe. */
const MAX_CADENCE = 3.2
const STRIDE_M = 0.75

/**
 * Procedural EVA astronaut, 1.8 m tall, no textures: white suit, PLSS backpack, gold visor. Low-poly primitives with three shared
 * materials (about a dozen draw calls). It stands where the shared agent pose says (`roverLive`, driven by the playback driver),
 * rests on the terrain with `sampleHeight`, and walks with a simple swing whose cadence follows the real ground speed.
 * Visible only while the Astronaut profile is selected (the rover model hides then). Local axes: +x forward, +y up.
 */
export function Astronaut({ hf }: { hf: Heightfield }) {
  const root = useRef<Group>(null)
  const legL = useRef<Group>(null)
  const legR = useRef<Group>(null)
  const armL = useRef<Group>(null)
  const armR = useRef<Group>(null)
  const body = useRef<Group>(null)
  const st = useRef({ x: NaN, z: NaN, phase: 0, amp: 0, yaw: 0 })

  const m = useMemo(
    () => ({
      suit: new MeshStandardMaterial({ color: '#eef0f3', roughness: 0.75, metalness: 0.05 }),
      pack: new MeshStandardMaterial({ color: '#b9c0ca', roughness: 0.6, metalness: 0.2 }),
      gold: new MeshStandardMaterial({ color: '#d9a21b', roughness: 0.18, metalness: 0.9, emissive: '#3a2600', emissiveIntensity: 0.4 }),
      grey: new MeshStandardMaterial({ color: '#5a626d', roughness: 0.7, metalness: 0.25 }),
    }),
    [],
  )

  useFrame((_, dtRaw) => {
    const g = root.current
    if (!g) return
    const astro = useMission.getState().profile === 'astronaut'
    g.visible = astro && roverLive.ready
    if (!g.visible) return
    const dt = Math.min(dtRaw, 0.1)
    const s = st.current
    if (Number.isNaN(s.x)) {
      s.x = roverLive.x
      s.z = roverLive.z
    }
    const speed = dt > 0 ? Math.hypot(roverLive.x - s.x, roverLive.z - s.z) / dt : 0
    s.x = roverLive.x
    s.z = roverLive.z
    const moving = speed > 0.15 && speed < 60 // a teleport (seek) is not a stride
    const cadence = moving ? Math.min(MAX_CADENCE, speed / STRIDE_M) : 0
    s.phase += cadence * Math.PI * 2 * dt
    s.amp += ((moving ? 1 : 0) - s.amp) * (1 - Math.exp(-10 * dt))
    const sw = Math.sin(s.phase) * 0.55 * s.amp
    if (legL.current) legL.current.rotation.z = sw
    if (legR.current) legR.current.rotation.z = -sw
    if (armL.current) armL.current.rotation.z = -sw * 0.8
    if (armR.current) armR.current.rotation.z = sw * 0.8
    const bob = Math.abs(Math.cos(s.phase)) * 0.04 * s.amp
    s.yaw += (((roverLive.yaw - s.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-8 * dt))
    g.position.set(roverLive.x, hf.sampleHeight(roverLive.x, roverLive.z), roverLive.z)
    g.rotation.y = -s.yaw
    if (body.current) body.current.position.y = bob
  })

  return (
    <group ref={root} name="astronaut" visible={false}>
      <group ref={body}>
        {/* legs pivot at the hip (0.88 m) */}
        {[legL, legR].map((ref, i) => (
          <group key={i} ref={ref} position={[0, 0.88, i ? 0.12 : -0.12]}>
            <mesh castShadow material={m.suit} position={[0, -0.36, 0]}>
              <boxGeometry args={[0.17, 0.68, 0.17]} />
            </mesh>
            <mesh castShadow material={m.grey} position={[0.04, -0.8, 0]}>
              <boxGeometry args={[0.3, 0.16, 0.19]} />
            </mesh>
          </group>
        ))}
        {/* torso, hip belt */}
        <mesh castShadow material={m.suit} position={[0, 1.18, 0]}>
          <boxGeometry args={[0.3, 0.6, 0.46]} />
        </mesh>
        <mesh material={m.grey} position={[0, 0.9, 0]}>
          <boxGeometry args={[0.32, 0.07, 0.48]} />
        </mesh>
        {/* PLSS life-support backpack */}
        <mesh castShadow material={m.pack} position={[-0.27, 1.22, 0]}>
          <boxGeometry args={[0.26, 0.55, 0.4]} />
        </mesh>
        <mesh material={m.grey} position={[-0.27, 1.5, 0]}>
          <boxGeometry args={[0.2, 0.08, 0.3]} />
        </mesh>
        {/* arms pivot at the shoulder (1.42 m) */}
        {[armL, armR].map((ref, i) => (
          <group key={i} ref={ref} position={[0, 1.42, i ? 0.3 : -0.3]}>
            <mesh castShadow material={m.suit} position={[0, -0.28, 0]}>
              <boxGeometry args={[0.14, 0.56, 0.14]} />
            </mesh>
            <mesh material={m.grey} position={[0, -0.6, 0]}>
              <boxGeometry args={[0.15, 0.1, 0.15]} />
            </mesh>
          </group>
        ))}
        {/* helmet with gold visor */}
        <mesh castShadow material={m.suit} position={[0.01, 1.62, 0]}>
          <sphereGeometry args={[0.22, 14, 10]} />
        </mesh>
        <mesh material={m.gold} position={[0.1, 1.63, 0]} scale={[0.75, 0.9, 1]}>
          <sphereGeometry args={[0.18, 14, 10]} />
        </mesh>
      </group>
    </group>
  )
}
