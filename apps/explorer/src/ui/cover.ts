import { useLayoutEffect, type RefObject } from 'react'
import { useApp } from '@/store/app'

/**
 * Layout contract for floating map UI. `#scene` exposes (px):
 *   --cover-top     topbar height
 *   --cover-left    0 (the rail sits outside #scene)
 *   --cover-right   inspector width + gap when the side card is open (desktop), else 0
 *   --cover-bottom  distance from the bottom of the view to the top of the highest bottom chrome
 *                   (telemetry; on phones also the bottom nav and the sheet)
 * Chrome elements opt in with `data-chrome="top" | "side" | "bottom"`. Widgets position themselves with
 * `calc(var(--cover-bottom) + 12px)` and never overlap the chrome.
 */
export interface Cover {
  top: number
  left: number
  right: number
  bottom: number
}

/** Pure part, unit-tested: boxes are DOMRect-like. `view` is the #scene box. */
export function computeCover(
  view: { top: number; right: number; bottom: number },
  top: { bottom: number } | null,
  side: { left: number } | null,
  bottoms: { top: number }[],
): Cover {
  const topV = top ? Math.max(0, top.bottom - view.top) : 56
  const right = side ? Math.max(0, view.right - side.left) : 0
  const minTop = bottoms.length ? Math.min(...bottoms.map((b) => b.top)) : view.bottom - 32
  const bottom = Math.max(0, view.bottom - minTop)
  return { top: Math.round(topV), left: 0, right: Math.round(right), bottom: Math.round(bottom) }
}

export function useCoverVars(ref: RefObject<HTMLElement | null>) {
  const open = useApp((s) => s.inspectorOpen)
  const snap = useApp((s) => s.sheetSnap)
  useLayoutEffect(() => {
    const main = ref.current
    if (!main) return
    const measure = () => {
      const view = main.getBoundingClientRect()
      const one = (n: string) => document.querySelector<HTMLElement>(`[data-chrome="${n}"]`)?.getBoundingClientRect() ?? null
      const bottoms = [...document.querySelectorAll<HTMLElement>('[data-chrome="bottom"]')]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
      const c = computeCover(view, one('top'), one('side'), bottoms)
      main.style.setProperty('--cover-top', `${c.top}px`)
      main.style.setProperty('--cover-left', `${c.left}px`)
      main.style.setProperty('--cover-right', `${c.right}px`)
      main.style.setProperty('--cover-bottom', `${c.bottom}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(main)
    document.querySelectorAll('[data-chrome]').forEach((e) => ro.observe(e))
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, open, snap])
}
