import type { CameraMode } from '@/store/camera'

export const MAX_SHOWS = 3
export const HINT_MS = 6000
const KEY = 'marsx.nav.hints'

export type HintCounts = Partial<Record<CameraMode, number>>

export const shouldShow = (c: HintCounts, m: CameraMode): boolean => (c[m] ?? 0) < MAX_SHOWS
export const bumpCount = (c: HintCounts, m: CameraMode): HintCounts => ({ ...c, [m]: (c[m] ?? 0) + 1 })

export function readCounts(): HintCounts {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as HintCounts) : {}
  } catch {
    return {}
  }
}
export function writeCounts(c: HintCounts): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage can be blocked */
  }
}

/** Plain-text hint (the chip renders the keys as keycaps from the same strings: tokens inside [brackets]). */
export function hintFor(m: CameraMode, touch: boolean): string {
  if (touch) {
    if (m === 'orbit') return 'Drag to orbit · Pinch to zoom · Double-tap to fly'
    if (m === 'fpv') return 'Left stick to move · Drag to look · Esc leaves'
    return 'Drag to look around · Tap Pause to hold'
  }
  if (m === 'orbit') return '[Drag] to orbit · [Right-drag] to pan · [Scroll] to zoom · [Double-click] to fly'
  if (m === 'fpv') return '[W][A][S][D] to move · Mouse to look · [Shift] to run · [Esc] to leave'
  return 'Drag to look around · [Space] to pause · [Esc] to leave'
}
