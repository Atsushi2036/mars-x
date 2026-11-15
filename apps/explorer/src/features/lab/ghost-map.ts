import { cellToWorld, type PlanGrid, type XZ } from '@/core/mission/geometry'

/** Where the learning grid sits inside the planning grid: top-left planning cell and fine cells per learning cell. */
export interface LearnerCrop {
  r0: number
  c0: number
  factor: number
  rows: number
  cols: number
}

/** Flat planning-grid index of the centre of a learning cell's block. */
export function learnerCellToPlanIndex(crop: LearnerCrop, planN: number, cell: number): number {
  const r = Math.floor(cell / crop.cols)
  const c = cell - r * crop.cols
  const row = crop.r0 + r * crop.factor + Math.floor(crop.factor / 2)
  const col = crop.c0 + c * crop.factor + Math.floor(crop.factor / 2)
  return row * planN + col
}

/** World position (metres, x/z) of a learning cell, for the 3D ghost. */
export function learnerCellToWorld(crop: LearnerCrop, grid: PlanGrid, cell: number): XZ {
  return cellToWorld(grid, learnerCellToPlanIndex(crop, grid.n, cell))
}

/** Axis-aligned world box (metres) of the learning grid, from its four corner cells: what "Follow the learner" frames. */
export function cropBounds(crop: LearnerCrop, grid: PlanGrid): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const corners = [0, crop.cols - 1, (crop.rows - 1) * crop.cols, crop.rows * crop.cols - 1].map((c) => learnerCellToWorld(crop, grid, c))
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)),
    maxZ: Math.max(...corners.map((p) => p.z)),
  }
}
