import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CapsuleGeometry, CircleGeometry, MeshBasicMaterial, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, type Group } from 'three'
import type { Heightfield } from '@/core/terrain/heightfield'
import { useMission } from '@/store/mission'
import { roverLive } from '@/store/rover'

/** Stride cadence cap (steps per second): at 16x playback the legs must not strobe. */
const MAX_CADENCE = 3.2
const STRIDE_M = 0.75
const UP = new Vector3(0, 1, 0)

/**
 * Procedural EVA astronaut, 1.8 m tall, no textures. Rounded suit (capsule limbs with knees and elbows, a wide chest), helmet with a
 * metallic gold visor that shows from the front and the sides, PLSS backpack with a lid, dark grey boots and gloves, and an
 * agent-amber belt and arm bands so it reads from far away. About 20 small meshes sharing 6 materials and 3 geometries-per-shape,
 * plus a soft contact shadow tilted to the ground. It stands where the shared agent pose says (`roverLive`, moved by the playback
 * driver), rests on the terrain with `sampleHeight`, and walks with a swing whose cadence follows the real ground speed.
 * Visible only while the Astronaut profile is selected. Local axes: +x forward, +y up, z sideways.
 */
export function Astronaut({ hf }: { hf: Heightfield }) {
  const root = useRef<Group>(null)
  const shadow = useRef<Group>(null)
  const body = useRef<Group>(null)
  const hip = [useRef<Group>(null), useRef<Group>(null)]
  const knee = [useRef<Group>(null), useRef<Group>(null)]
  const shoulder = [useRef<Group>(null), useRef<Group>(null)]
  const elbow = [useRef<Group>(null), useRef<Group>(null)]
  const st = useRef({ x: NaN, z: NaN, phase: 0, amp: 0, yaw: 0 })
  const q = useRef(new Quaternion())
  const n = useRef(new Vector3())

  const r = useMemo(
    () => ({
      suit: new MeshStandardMaterial({ color: '#eef0f3', roughness: 0.7, metalness: 0.05 }),
      packMat: new MeshStandardMaterial({ color: '#b9c0ca', roughness: 0.6, metalness: 0.2 }),
      dark: new MeshStandardMaterial({ color: '#3b4048', roughness: 0.75, metalness: 0.2 }),
      gold: new MeshStandardMaterial({ color: '#f2b93c', roughness: 0.22, metalness: 0.55, emissive: '#a06a00', emissiveIntensity: 0.9 }),
      agent: new MeshStandardMaterial({ color: '#ffb81f', roughness: 0.5, metalness: 0.1, emissive: '#7a4d00', emissiveIntensity: 0.35 }),
      shadow: new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      pack: new CapsuleGeometry(0.15, 0.26, 4, 12),
      lid: new SphereGeometry(0.16, 14, 8),
      thigh: new CapsuleGeometry(0.088, 0.26, 4, 10),
      shin: new CapsuleGeometry(0.076, 0.24, 4, 10),
      boot: new CapsuleGeometry(0.075, 0.12, 4, 10).rotateZ(Math.PI / 2),
      upper: new CapsuleGeometry(0.062, 0.18, 4, 10),
      fore: new CapsuleGeometry(0.056, 0.16, 4, 10),
      glove: new SphereGeometry(0.068, 10, 8),
      torso: new CapsuleGeometry(0.17, 0.26, 6, 14),
      helmet: new SphereGeometry(0.235, 18, 14),
      visor: new SphereGeometry(0.2, 18, 14),
      disc: new CircleGeometry(0.62, 24).rotateX(-Math.PI / 2),
    }),
    [],
  )

  useFrame((_, dtRaw) => {
    const g = root.current
    const sh = shadow.current
    if (!g || !sh) return
    const astro = useMission.getState().profile === 'astronaut'
    g.visible = sh.visible = astro && roverLive.ready
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
    for (let i = 0; i < 2; i++) {
      const ph = s.phase + (i ? Math.PI : 0)
      const sw = Math.sin(ph) * 0.55 * s.amp
      const fwd = Math.max(0, Math.cos(ph)) // leg or arm moving forward
      const h = hip[i]?.current
      const k = knee[i]?.current
      if (h) h.rotation.z = sw
      if (k) k.rotation.z = -(0.08 + 0.75 * fwd * s.amp)
      const a = shoulder[i]?.current
      const e = elbow[i]?.current
      if (a) a.rotation.z = -sw * 0.8
      if (e) e.rotation.z = 0.25 + 0.5 * Math.max(0, Math.cos(ph + Math.PI)) * s.amp
    }
    const bob = Math.abs(Math.cos(s.phase)) * 0.035 * s.amp
    s.yaw += (((roverLive.yaw - s.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (1 - Math.exp(-8 * dt))
    const y = hf.sampleHeight(roverLive.x, roverLive.z)
    g.position.set(roverLive.x, y, roverLive.z)
    g.rotation.y = -s.yaw
    if (body.current) body.current.position.y = bob
    // contact shadow follows the slope
    const nn = hf.normalAt(roverLive.x, roverLive.z)
    q.current.setFromUnitVectors(UP, n.current.set(nn.x, nn.y, nn.z).normalize())
    sh.position.set(roverLive.x, y + 0.03, roverLive.z)
    sh.quaternion.copy(q.current)
  })

  const sides = [-1, 1] as const
  return (
    <>
      <group ref={shadow} visible={false}>
        <mesh geometry={r.disc} material={r.shadow} renderOrder={1} />
      </group>
      <group ref={root} name="astronaut" visible={false}>
        <group ref={body}>
          {/* legs: hip, thigh, knee, shin, boot */}
          {sides.map((side, i) => (
            <group key={`l${side}`} ref={hip[i]} position={[0, 0.9, side * 0.115]}>
              <mesh castShadow geometry={r.thigh} material={r.suit} position={[0, -0.2, 0]} />
              <group ref={knee[i]} position={[0, -0.41, 0]}>
                <mesh castShadow geometry={r.shin} material={r.suit} position={[0, -0.18, 0]} />
                <mesh castShadow geometry={r.boot} material={r.dark} position={[0.05, -0.4, 0]} />
              </group>
            </group>
          ))}
          {/* torso: capsule widened across the chest */}
          <mesh castShadow geometry={r.torso} material={r.suit} position={[0, 1.18, 0]} scale={[0.95, 1, 1.5]} />
          {/* belt in the agent colour */}
          <mesh position={[0, 0.96, 0]} scale={[1, 1, 1.4]}>
            <cylinderGeometry args={[0.185, 0.185, 0.06, 18]} />
            <primitive object={r.agent} attach="material" />
          </mesh>
          {/* PLSS backpack with a lid */}
          <mesh castShadow geometry={r.pack} material={r.packMat} position={[-0.26, 1.2, 0]} scale={[0.85, 1, 1.5]} />
          <mesh castShadow geometry={r.lid} material={r.suit} position={[-0.26, 1.42, 0]} scale={[0.95, 0.32, 1.5]} />
          {/* arms: shoulder, upper arm (amber band), elbow, forearm, glove */}
          {sides.map((side, i) => (
            <group key={`a${side}`} ref={shoulder[i]} position={[0, 1.4, side * 0.33]}>
              <mesh castShadow geometry={r.upper} material={r.suit} position={[0, -0.14, 0]} />
              <mesh position={[0, -0.1, 0]}>
                <cylinderGeometry args={[0.068, 0.068, 0.04, 12]} />
                <primitive object={r.agent} attach="material" />
              </mesh>
              <group ref={elbow[i]} position={[0, -0.28, 0]}>
                <mesh castShadow geometry={r.fore} material={r.suit} position={[0, -0.13, 0]} />
                <mesh geometry={r.glove} material={r.dark} position={[0, -0.29, 0]} />
              </group>
            </group>
          ))}
          {/* neck ring, helmet, metallic gold visor (wraps front and sides) */}
          <mesh material={r.dark} position={[0, 1.47, 0]}>
            <cylinderGeometry args={[0.13, 0.15, 0.06, 14]} />
          </mesh>
          <mesh castShadow geometry={r.helmet} material={r.suit} position={[0, 1.57, 0]} />
          <mesh geometry={r.visor} material={r.gold} position={[0.075, 1.575, 0]} scale={[0.9, 0.82, 1.02]} />
        </group>
      </group>
    </>
  )
}
