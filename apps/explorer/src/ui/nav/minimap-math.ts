import type { Extent } from '@/store/camera-math'

/** Square canvas frame covering the (possibly non-square) tile, centred, north up. */
export interface MiniFrame {
  x0: number
  z0: number
  /** metres per canvas pixel */
  mpp: number
  size: number
  /** canvas offset of the tile's top-left corner (letterbox) */
  ox: number
  oy: number
}

export function miniFrame(ext: Extent, size: number): MiniFrame {
  const w = ext.xMax - ext.xMin
  const h = ext.zMax - ext.zMin
  const span = Math.max(w, h)
  const mpp = span / size
  return { x0: ext.xMin, z0: ext.zMin, mpp, size, ox: (size - w / mpp) / 2, oy: (size - h / mpp) / 2 }
}

export const worldToMini = (x: number, z: number, f: MiniFrame): { x: number; y: number } => ({
  x: (x - f.x0) / f.mpp + f.ox,
  y: (z - f.z0) / f.mpp + f.oy,
})

/** Canvas pixel to world metres, clamped into the tile. */
export function miniToWorld(px: number, py: number, f: MiniFrame, ext: Extent): { x: number; z: number } {
  const x = f.x0 + (px - f.ox) * f.mpp
  const z = f.z0 + (py - f.oy) * f.mpp
  return { x: Math.max(ext.xMin, Math.min(ext.xMax, x)), z: Math.max(ext.zMin, Math.min(ext.zMax, z)) }
}

/** Corners of the camera view cone on the map; `yaw` is the camera heading (0 = north, positive towards west like atan2(-dx,-dz)). */
export function coneWedge(at: { x: number; y: number }, yaw: number, fovDeg: number, len: number) {
  const half = (Math.min(fovDeg * 1.5, 120) * Math.PI) / 360 // horizontal field is wider than the vertical one
  const dir = (a: number) => ({ x: at.x + -Math.sin(a) * len, y: at.y + -Math.cos(a) * len })
  return { left: dir(yaw + half), right: dir(yaw - half) }
}
