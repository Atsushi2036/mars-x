import { MeshStandardMaterial, type Texture, type WebGLProgramParametersWithUniforms } from 'three'

/**
 * Terrain material: ONE shader program shared by every chunk (identical customProgramCacheKey).
 * Layer state lives in shared uniform objects, so changing the active layer / opacity is a single
 * assignment that every chunk sees. Layer ids: 0 none, 1 slope, 2 hazard (reserved), 3 CRISM (reserved).
 *
 * The HiRISE orthoimage is a single RED band (monochrome). It is shown through a false-colour tint ramp
 * that evokes Mars; the UI states this ("HiRISE RED band, false-color tint").
 */
export const LAYER_IDS = { none: 0, slope: 1, hazard: 2, crism: 3 } as const

export const terrainUniforms = {
  uLayer: { value: 0 },
  uLayerOpacity: { value: 0.7 },
  uSlopeMax: { value: 30 },
}

const PROGRAM_KEY = 'marsx-terrain-v1'

/** Every chunk material has a map (a mid-grey placeholder until its tile arrives): one program variant only. */
export function createTerrainMaterial(map: Texture): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, map })
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLayer = terrainUniforms.uLayer
    shader.uniforms.uLayerOpacity = terrainUniforms.uLayerOpacity
    shader.uniforms.uSlopeMax = terrainUniforms.uSlopeMax
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMarsN;\nvarying float vMarsY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarsN = normal;\nvMarsY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMarsN;
varying float vMarsY;
uniform float uLayer;
uniform float uLayerOpacity;
uniform float uSlopeMax;

// false-colour tint for the monochrome HiRISE RED band: dark basalt -> rust -> pale dust
vec3 marsTint(float l) {
  l = clamp(l, 0.0, 1.0);
  vec3 a = vec3(0.045, 0.030, 0.028);
  vec3 b = vec3(0.30, 0.15, 0.085);
  vec3 c = vec3(0.62, 0.36, 0.20);
  vec3 d = vec3(0.86, 0.66, 0.47);
  vec3 o = mix(a, b, smoothstep(0.0, 0.30, l));
  o = mix(o, c, smoothstep(0.25, 0.62, l));
  o = mix(o, d, smoothstep(0.55, 1.0, l));
  return o;
}

// perceptually ordered ramp (viridis-like), never a red ramp
vec3 viridisLike(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.267, 0.005, 0.329);
  vec3 c1 = vec3(0.231, 0.322, 0.546);
  vec3 c2 = vec3(0.128, 0.567, 0.551);
  vec3 c3 = vec3(0.369, 0.789, 0.383);
  vec3 c4 = vec3(0.993, 0.906, 0.144);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `
  float marsL = texture2D( map, vMapUv ).r;
  vec3 marsAlbedo = marsTint(marsL);
  diffuseColor.rgb = marsAlbedo;
  if (uLayer > 0.5 && uLayer < 1.5) {
    float slopeDeg = degrees(acos(clamp(normalize(vMarsN).y, -1.0, 1.0)));
    vec3 lc = viridisLike(slopeDeg / uSlopeMax);
    diffuseColor.rgb = mix(diffuseColor.rgb, lc, uLayerOpacity);
  }`,
      )
  }
  m.customProgramCacheKey = () => PROGRAM_KEY
  return m
}
