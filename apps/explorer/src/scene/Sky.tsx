import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { BackSide, Color, FogExp2, Mesh, ShaderMaterial, Vector3 } from 'three'
import { terrainUniforms } from './terrain-material'
import { useThree } from '@react-three/fiber'
import { sunDirection, useApp } from '@/store/app'

const HORIZON = new Color(0.78, 0.5, 0.34)
const HAZE_DULL = new Color(0.5, 0.36, 0.28)
const ZENITH = new Color(0.3, 0.2, 0.19)

/** Procedural Mars sky: butterscotch dust near the horizon, a faint blue glow around the sun, dark at night. */
export function Sky() {
  const mesh = useRef<Mesh>(null)
  const scene = useThree((s) => s.scene)
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uHorizon: { value: HORIZON.clone() },
          uZenith: { value: ZENITH.clone() },
          uSun: { value: new Vector3(0, 1, 0) },
          uDay: { value: 1 },
        },
        vertexShader: `varying vec3 vDir;
void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `varying vec3 vDir;
uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun; uniform float uDay;
void main(){
  float h = clamp(vDir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  float s = max(dot(normalize(vDir), normalize(uSun)), 0.0);
  col += vec3(0.28, 0.36, 0.48) * pow(s, 14.0) * 0.55 + vec3(1.0, 0.92, 0.8) * pow(s, 900.0) * 1.4;
  col *= uDay;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      }),
    [],
  )

  useFrame(({ camera }) => {
    const { sun, haze } = useApp.getState()
    const d = sunDirection(sun.azimuthDeg, sun.elevationDeg)
    const day = Math.min(1, Math.max(0.06, (sun.elevationDeg + 4) / 14))
    mat.uniforms.uSun!.value.set(d[0], d[1], d[2])
    mat.uniforms.uDay!.value = day
    if (mesh.current) mesh.current.position.copy(camera.position)
    if (!scene.fog) scene.fog = new FogExp2(HORIZON.clone(), 0.00032)
    const fog = scene.fog as FogExp2
    // dust optical depth: denser, duller haze as tau grows (0.5 is the nominal Jezero value)
    fog.density = 0.00012 + 0.0003 * haze
    fog.color.copy(HORIZON).lerp(HAZE_DULL, Math.min(1, haze / 6)).multiplyScalar(day * 0.92)
    terrainUniforms.uFadeColor.value.copy(HORIZON).multiplyScalar(day)
    scene.background = null
  })

  return (
    <mesh ref={mesh} renderOrder={-10} frustumCulled={false} material={mat}>
      <sphereGeometry args={[6000, 32, 16]} />
    </mesh>
  )
}
