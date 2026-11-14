/** True when a WebGL2 context can be created (checked before any 3D code is downloaded). */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    const ok = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch {
    return false
  }
}
