/** Pure helpers for the "there is more below" hints of the inspector and the mobile sheet. */

export interface ScrollHints {
  /** content hidden above the visible area (fade at the top) */
  above: boolean
  /** content hidden below the visible area (fade, pill, scrollbar cue) */
  below: boolean
}

/** Slack in px: sub-pixel rounding and a few px of padding must not count as "more content". */
export const EDGE_SLACK = 8

export function scrollHints(scrollTop: number, clientHeight: number, scrollHeight: number): ScrollHints {
  if (clientHeight <= 0 || scrollHeight - clientHeight <= EDGE_SLACK) return { above: false, below: false }
  return {
    above: scrollTop > EDGE_SLACK,
    below: scrollHeight - clientHeight - scrollTop > EDGE_SLACK,
  }
}

/** Target scrollTop for one press of the pill: about 80 % of the visible height, never past the end. */
export function pageDownTarget(scrollTop: number, clientHeight: number, scrollHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight)
  return Math.min(max, scrollTop + Math.round(clientHeight * 0.8))
}

/** First heading that starts below the visible area (its title names what is hidden), or null. */
export function nextSectionTitle(items: { title: string; top: number }[], viewBottom: number): string | null {
  const hit = items.filter((i) => i.title.trim() && i.top > viewBottom - 8).sort((a, b) => a.top - b.top)[0]
  return hit ? hit.title.trim() : null
}

/** Pill text: the next section when it is short enough, otherwise a generic label. */
export function pillLabel(next: string | null): string {
  return next && next.length <= 26 ? next : 'More below'
}
