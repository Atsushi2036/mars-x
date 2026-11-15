import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { DirectionalLight, Object3D } from 'three'
import { sunDirection, sunLive } from '@/store/app'
import { cameraRig } from '@/store/camera'
import { terrainUniforms } from './terrain-material'

const MIN_HALF = 90 // metres around the focus covered by the shadow map when close to the ground
const MAX_HALF = 1250 // overview: covers the whole window so there is no visible shadow-frustum edge
const MAP_SIZE = typeof window !== 'undefined' && window.innerWidth < 768 ? 2048 : 4096

function setHalf(c: DirectionalLight['shadow']['camera'], half: number) {
  c.left = -half
  c.right = half
  c.top = half
  c.bottom = -half
  c.updateProjectionMatrix()
}

/**
 * Directional sun with a shadow map that follows the camera focus. The direction comes from the store
 * (`setSun(azimuthDeg, elevationDeg)`, driven later by the conditions engine).
 */
export function Sun() {
  const light = useRef<DirectionalLight>(null)
  const target = useRef<Object3D>(null)

  useEffect(() => {
    const l = light.current
    const t = target.current
    if (!l || !t) return
    l.target = t
    l.shadow.mapSize.set(MAP_SIZE, MAP_SIZE)
    const c = l.shadow.camera
    c.near = 10
    c.far = 3200
    setHalf(c, MIN_HALF * 2)
  }, [])

  useFrame(({ camera }) => {
    const l = light.current
    const t = target.current
    if (!l || !t) return
    const sun = sunLive
    terrainUniforms.uSunAz.value = sun.azimuthDeg
    terrainUniforms.uSunEl.value = sun.elevationDeg
    const d = sunDirection(sun.azimuthDeg, sun.elevationDeg)
    const f = cameraRig.focus
    // snap the focus to the shadow texel grid so shadows do not shimmer while moving
    // shadow coverage follows the camera distance: tight and sharp on the ground, whole window in the overview
    const dist = Math.hypot(camera.position.x - f.x, camera.position.y - f.y, camera.position.z - f.z)
    const want = Math.min(MAX_HALF, Math.max(MIN_HALF, dist * 0.9))
    const cur = l.shadow.camera.right
    if (Math.abs(want - cur) / cur > 0.08) setHalf(l.shadow.camera, want)
    const texel = (2 * l.shadow.camera.right) / MAP_SIZE
    const fx = Math.round(f.x / texel) * texel
    const fz = Math.round(f.z / texel) * texel
    t.position.set(fx, f.y, fz)
    l.position.set(fx + d[0] * 1600, f.y + d[1] * 1600, fz + d[2] * 1600)
    t.updateMatrixWorld()
    const day = Math.min(1, Math.max(0, (sun.elevationDeg + 1) / 6))
    l.intensity = 3.4 * day
    l.castShadow = day > 0.02
  })

  return (
    <>
      <directionalLight ref={light} color="#fff1dd" intensity={3.4} castShadow shadow-bias={-0.0006} shadow-normalBias={0.5} />
      <object3D ref={target} />
      <hemisphereLight args={['#e9b896', '#4a2c1e', 0.75]} />
    </>
  )
}
