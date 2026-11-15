/** Pure logic of the guided mission: step machine, keyboard mapping, URL flag and the science stop choice. */
export interface TourState {
  active: boolean
  index: number
}
export const INITIAL: TourState = { active: false, index: 0 }

export type TourAction = { type: 'start' } | { type: 'next' } | { type: 'back' } | { type: 'exit' } | { type: 'goto'; index: number }

export function reduce(s: TourState, a: TourAction, count: number): TourState {
  switch (a.type) {
    case 'start':
      return { active: true, index: 0 }
    case 'exit':
      return INITIAL
    case 'goto':
      return s.active ? { active: true, index: Math.max(0, Math.min(count - 1, a.index)) } : s
    case 'next':
      if (!s.active) return s
      return s.index >= count - 1 ? INITIAL : { active: true, index: s.index + 1 }
    case 'back':
      return s.active ? { active: true, index: Math.max(0, s.index - 1) } : s
  }
}

export interface KeyInfo {
  key: string
  target: { tagName: string; role?: string | null; isContentEditable?: boolean } | null
  dialogOpen: boolean
}

const OWN_ARROWS = new Set(['slider', 'radio', 'tab', 'menuitem', 'option', 'spinbutton'])

/** Maps a key press to a tour action; returns null when the key belongs to the focused control or an open dialog. */
export function keyAction(k: KeyInfo): 'next' | 'back' | 'exit' | null {
  if (k.dialogOpen) return null
  const t = k.target
  if (t) {
    const tag = t.tagName.toUpperCase()
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return null
    if (t.role && OWN_ARROWS.has(t.role) && k.key !== 'Escape') return null
  }
  if (k.key === 'ArrowRight') return 'next'
  if (k.key === 'ArrowLeft') return 'back'
  if (k.key === 'Escape') return 'exit'
  return null
}

export function tourRequested(search: string): boolean {
  const v = new URLSearchParams(search).get('tour')
  return v === '1' || v === 'true'
}

export interface Pt {
  x: number
  z: number
}

const TARGET_M = 500

/**
 * Deterministic science stop: the first waypoint of the traverse is the origin, and the waypoint whose straight-line
 * distance is closest to 500 m is the destination (a walk long enough to matter, short enough for an EVA).
 */
export function pickWaypoints<T extends Pt>(wps: readonly T[]): { origin: T; destination: T } | null {
  const origin = wps[0]
  if (!origin || wps.length < 2) return null
  let best: T | null = null
  let bestErr = Infinity
  for (const w of wps.slice(1)) {
    const err = Math.abs(Math.hypot(w.x - origin.x, w.z - origin.z) - TARGET_M)
    if (err < bestErr) {
      best = w
      bestErr = err
    }
  }
  return best ? { origin, destination: best } : null
}
