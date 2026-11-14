import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { DirectionalLight, Object3D } from 'three'
import { sunDirection, useApp } from '@/store/app'
import { cameraRig } from '@/store/camera'

const SHADOW_HALF = 260 // metres around the focus covered by the shadow map
const MAP_SIZE = 2048

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
    c.left = -SHADOW_HALF
    c.right = SHADOW_HALF
    c.top = SHADOW_HALF
    c.bottom = -SHADOW_HALF
    c.near = 10
    c.far = 1600
    c.updateProjectionMatrix()
  }, [])

  useFrame(() => {
    const l = light.current
    const t = target.current
    if (!l || !t) return
    const { sun } = useApp.getState()
    const d = sunDirection(sun.azimuthDeg, sun.elevationDeg)
    const f = cameraRig.focus
    // snap the focus to the shadow texel grid so shadows do not shimmer while moving
    const texel = (2 * SHADOW_HALF) / MAP_SIZE
    const fx = Math.round(f.x / texel) * texel
    const fz = Math.round(f.z / texel) * texel
    t.position.set(fx, f.y, fz)
    l.position.set(fx + d[0] * 700, f.y + d[1] * 700, fz + d[2] * 700)
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
