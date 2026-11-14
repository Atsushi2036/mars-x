import { Color, MeshStandardMaterial, Vector4, type Texture, type WebGLProgramParametersWithUniforms } from 'three'

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
  /** raster extent in world metres: xMin, zMin, xMax, zMax (set when the dataset loads) */
  uExtent: { value: new Vector4(-1e6, -1e6, 1e6, 1e6) },
  /** colour the terrain dissolves into at the border of the window (matches the sky at the horizon) */
  uFadeColor: { value: new Color(0.78, 0.5, 0.34) },
  uFadeWidth: { value: 260 },
}

const PROGRAM_KEY = 'marsx-terrain-v1'

/** Every chunk material has a map (a mid-grey placeholder until its tile arrives): one program variant only. */
export function createTerrainMaterial(map: Texture): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, map })
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLayer = terrainUniforms.uLayer
    shader.uniforms.uLayerOpacity = terrainUniforms.uLayerOpacity
    shader.uniforms.uSlopeMax = terrainUniforms.uSlopeMax
    shader.uniforms.uExtent = terrainUniforms.uExtent
    shader.uniforms.uFadeColor = terrainUniforms.uFadeColor
    shader.uniforms.uFadeWidth = terrainUniforms.uFadeWidth
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMarsN;\nvarying float vMarsY;\nvarying vec2 vMarsXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMarsN = normal;\nvMarsY = position.y;\nvMarsXZ = position.xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vMarsN;
varying float vMarsY;
varying vec2 vMarsXZ;
uniform vec4 uExtent;
uniform vec3 uFadeColor;
uniform float uFadeWidth;
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
        '#include <tonemapping_fragment>',
        `{
  // relative lighting (0.35 shadow .. 1.5 lit) keeps relief readable under the overlay
  float marsLit = clamp(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)) / max(dot(marsAlbedo, vec3(0.299, 0.587, 0.114)), 0.02), 0.4, 1.3);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, marsLayerColor * marsLit * 0.85, marsLayerMix);
}
{
  float edgeD = min(min(vMarsXZ.x - uExtent.x, uExtent.z - vMarsXZ.x), min(vMarsXZ.y - uExtent.y, uExtent.w - vMarsXZ.y));
  float edgeK = 1.0 - smoothstep(0.0, uFadeWidth, edgeD);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, edgeK * edgeK);
}
#include <tonemapping_fragment>`,
      )
      .replace(
        '#include <map_fragment>',
        `
  float marsL = texture2D( map, vMapUv ).r;
  vec3 marsAlbedo = marsTint(marsL);
  diffuseColor.rgb = marsAlbedo;
  // overlay layers are applied AFTER lighting (see tonemapping chunk) so their colours are not tinted by the warm sun
  vec3 marsLayerColor = vec3(0.0);
  float marsLayerMix = 0.0;
  if (uLayer > 0.5 && uLayer < 1.5) {
    float slopeDeg = degrees(acos(clamp(normalize(vMarsN).y, -1.0, 1.0)));
    marsLayerColor = viridisLike(slopeDeg / uSlopeMax);
    marsLayerMix = uLayerOpacity;
  }`,
      )
  }
  m.customProgramCacheKey = () => PROGRAM_KEY
  return m
}
