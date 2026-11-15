import {
  Color,
  DataArrayTexture,
  DataTexture,
  MeshStandardMaterial,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three'

/**
 * Terrain material: ONE shader program shared by every chunk (identical customProgramCacheKey).
 * Layer state lives in shared uniform objects, so changing the active layer / opacity is a single
 * assignment that every chunk sees. Layer ids: 0 none, 1 slope, 2 hazard, 3 CRISM, 4 wheel slip, 5 illumination.
 * Overlays are composited AFTER tone mapping and the sRGB conversion, so their on-screen colours are exactly the
 * hex values shown in the legends.
 *
 * The HiRISE orthoimage is a single RED band (monochrome). It is shown through a false-colour tint ramp
 * that evokes Mars; the UI states this ("HiRISE RED band, false-color tint").
 */
export const LAYER_IDS = { none: 0, slope: 1, hazard: 2, crism: 3, slip: 4, illum: 5 } as const

const dummy2d = new DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, RGBAFormat, UnsignedByteType)
dummy2d.needsUpdate = true
const dummyR8 = new DataTexture(new Uint8Array([255]), 1, 1, RedFormat, UnsignedByteType)
dummyR8.needsUpdate = true
const dummyArray = new DataArrayTexture(new Uint8Array([255]), 1, 1, 1)
dummyArray.format = RedFormat
dummyArray.type = UnsignedByteType
dummyArray.unpackAlignment = 1
dummyArray.needsUpdate = true

export const terrainUniforms = {
  uLayer: { value: 0 },
  uLayerOpacity: { value: 0.7 },
  uSlopeMax: { value: 30 },
  /** raster extent in world metres: xMin, zMin, xMax, zMax (set when the dataset loads) */
  uExtent: { value: new Vector4(-1e6, -1e6, 1e6, 1e6) },
  /** colour the terrain dissolves into at the border of the window (matches the sky at the horizon) */
  uFadeColor: { value: new Color(0.78, 0.5, 0.34) },
  uFadeWidth: { value: 260 },
  /** data rasters (swapped in by the scene once loaded); 255 = nodata */
  uHazardTex: { value: dummyR8 as Texture },
  uSlipTex: { value: dummyR8 as Texture },
  uCrismTex: { value: dummy2d as Texture },
  uHorizonTex: { value: dummyArray as Texture },
  /** sun for the horizon-map shadow test: compass azimuth and elevation, degrees; uHorizonOn 0 until the maps are loaded */
  uSunAz: { value: 250 },
  uSunEl: { value: 30 },
  uHorizonOn: { value: 0 },
}

export const layerTextureUniforms = { hazard: terrainUniforms.uHazardTex, slip: terrainUniforms.uSlipTex, crism: terrainUniforms.uCrismTex, illum: terrainUniforms.uHorizonTex } as const

const PROGRAM_KEY = 'marsx-terrain-v2'

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
    shader.uniforms.uHazardTex = terrainUniforms.uHazardTex
    shader.uniforms.uSlipTex = terrainUniforms.uSlipTex
    shader.uniforms.uCrismTex = terrainUniforms.uCrismTex
    shader.uniforms.uHorizonTex = terrainUniforms.uHorizonTex
    shader.uniforms.uSunAz = terrainUniforms.uSunAz
    shader.uniforms.uSunEl = terrainUniforms.uSunEl
    shader.uniforms.uHorizonOn = terrainUniforms.uHorizonOn
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
uniform sampler2D uHazardTex;
uniform sampler2D uSlipTex;
uniform sampler2D uCrismTex;
uniform highp sampler2DArray uHorizonTex;
uniform float uSunAz;
uniform float uSunEl;
uniform float uHorizonOn;

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
}

// cividis (colour-blind safe, blue to yellow) for continuous data layers other than slope
vec3 cividisLike(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.000, 0.125, 0.302);
  vec3 c1 = vec3(0.192, 0.267, 0.420);
  vec3 c2 = vec3(0.400, 0.412, 0.439);
  vec3 c3 = vec3(0.584, 0.561, 0.471);
  vec3 c4 = vec3(0.796, 0.729, 0.412);
  vec3 c5 = vec3(1.000, 0.918, 0.275);
  float k = t * 5.0;
  if (k < 1.0) return mix(c0, c1, k);
  if (k < 2.0) return mix(c1, c2, k - 1.0);
  if (k < 3.0) return mix(c2, c3, k - 2.0);
  if (k < 4.0) return mix(c3, c4, k - 3.0);
  return mix(c4, c5, k - 4.0);
}

// 1 when the cell is in terrain shadow for the current sun (horizon maps: 16 azimuths, q * 0.5 degrees, 255 = nodata)
float marsTerrainShadow(vec2 uv) {
  if (uHorizonOn < 0.5) return 0.0;
  if (uSunEl <= 0.0) return 1.0;
  float pos = mod(uSunAz, 360.0) / 22.5;
  float i0 = floor(pos);
  float w = pos - i0;
  float i1 = mod(i0 + 1.0, 16.0);
  i0 = mod(i0, 16.0);
  float a = texture(uHorizonTex, vec3(uv, i0)).r * 255.0;
  float b = texture(uHorizonTex, vec3(uv, i1)).r * 255.0;
  if (a > 254.0 || b > 254.0) return 0.0;
  float h = mix(a, b, w) * 0.5;
  return 1.0 - smoothstep(h - 0.35, h + 0.35, uSunEl);
}`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        `// relative lighting (0.4 shadow .. 1.3 lit) keeps relief readable under the overlays
float marsLit = clamp(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)) / max(dot(marsAlbedo, vec3(0.299, 0.587, 0.114)), 0.02), 0.4, 1.3);
float marsEdgeD = min(min(vMarsXZ.x - uExtent.x, uExtent.z - vMarsXZ.x), min(vMarsXZ.y - uExtent.y, uExtent.w - vMarsXZ.y));
float marsEdge = 1.0 - smoothstep(0.0, uFadeWidth, marsEdgeD);
marsEdge *= marsEdge;
gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, marsEdge);
#include <tonemapping_fragment>`,
      )
      .replace(
        '#include <colorspace_fragment>',
        `#include <colorspace_fragment>
if (uLayer > 0.5) {
  vec2 mUv = (vMarsXZ - uExtent.xy) / (uExtent.zw - uExtent.xy);
  vec3 oc = vec3(0.0);
  float oa = 0.0;
  if (uLayer < 1.5) {
    float slopeDeg = degrees(acos(clamp(normalize(vMarsN).y, -1.0, 1.0)));
    oc = viridisLike(slopeDeg / uSlopeMax);
    oa = 1.0;
  } else if (uLayer < 2.5) {
    float hz = texture2D(uHazardTex, mUv).r;
    oc = cividisLike(hz * (255.0 / 254.0));
    oa = hz > 0.999 ? 0.0 : 1.0;
  } else if (uLayer < 3.5) {
    vec4 c = texture2D(uCrismTex, mUv);
    oc = c.rgb;
    oa = c.a;
  } else if (uLayer < 4.5) {
    float cls = floor(texture2D(uSlipTex, mUv).r * 255.0 + 0.5);
    if (cls < 0.5) oc = vec3(1.000, 0.918, 0.275);
    else if (cls < 1.5) oc = vec3(0.486, 0.482, 0.471);
    else oc = vec3(0.000, 0.125, 0.302);
    oa = cls > 2.5 ? 0.0 : 1.0;
  }
  if (uLayer > 4.5) {
    float sh = marsTerrainShadow(mUv) * (1.0 - marsEdge);
    gl_FragColor.rgb *= mix(vec3(1.0), vec3(0.36, 0.42, 0.66), sh * uLayerOpacity);
  } else {
    float relLit = clamp(mix(1.0, marsLit, 0.45), 0.62, 1.12);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, oc * relLit, oa * uLayerOpacity * (1.0 - marsEdge));
  }
}`,
      )
      .replace(
        '#include <map_fragment>',
        `
  float marsL = texture2D( map, vMapUv ).r;
  vec3 marsAlbedo = marsTint(marsL);
  diffuseColor.rgb = marsAlbedo;
  // overlay layers are composited at the very end of the shader (see colorspace chunk)`,
      )
  }
  m.customProgramCacheKey = () => PROGRAM_KEY
  return m
}
