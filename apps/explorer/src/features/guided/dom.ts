/** Small DOM helpers for steps that must reach into panels owned by other features (their state is component-local). */

const frame = () => new Promise<void>((r) => setTimeout(r, 60))

/** Polls until `find` returns an element (panels are lazy), up to `timeoutMs`. */
export async function waitFor<T>(find: () => T | null | undefined, timeoutMs = 2500): Promise<T | null> {
  const t0 = performance.now()
  for (;;) {
    const v = find()
    if (v) return v
    if (performance.now() - t0 > timeoutMs) return null
    await frame()
  }
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Scrolls the inspector so the section with this heading is at the top (instant: no motion). */
export async function scrollInspectorTo(title: string): Promise<void> {
  const want = norm(title)
  const h = await waitFor(() => [...document.querySelectorAll('aside[aria-label="Inspector"] h3')].find((e) => norm(e.textContent).startsWith(want)))
  if (!h) return
  // scroll only the panel's own scroller: scrollIntoView would also scroll the (overflow hidden) inspector card and hide its header
  const aside = h.closest('aside')
  const view = aside?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport], .overscroll-contain') ?? null
  if (!aside || !view) return
  // the Radix viewport scrolls when the card has a definite height; otherwise the card itself is the only thing that can move
  const scroller = view.scrollHeight > view.clientHeight + 1 ? view : aside
  scroller.scrollTop += h.getBoundingClientRect().top - view.getBoundingClientRect().top - 4
}

/** Clicks the first element of the given role whose accessible text matches (Radix toggle items are role=radio). */
export async function clickByRole(role: string, name: string, timeoutMs = 2500): Promise<boolean> {
  const want = norm(name)
  const el = await waitFor(() => [...document.querySelectorAll<HTMLElement>(`aside[aria-label="Inspector"] [role="${role}"]`)].find((e) => norm(e.textContent).includes(want)), timeoutMs)
  el?.click()
  return !!el
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
