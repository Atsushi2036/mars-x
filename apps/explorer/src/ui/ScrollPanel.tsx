import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from '@/ui/icons'
import { cn } from '@/lib/utils'
import { nextSectionTitle, pageDownTarget, pillLabel, scrollHints, type ScrollHints } from './scroll-hints'

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/** panels that already got their one-time nudge in this session */
const nudged = new Set<string>()

/**
 * Scroll area for the inspector and the mobile sheet that says when there is more to see:
 * a fade at the bottom (and at the top once scrolled), a "More below" pill that pages down, a visible scrollbar,
 * and a single small bounce the first time a long panel opens. It re-measures when the content changes size
 * (a route result arriving, a section opening). The scroller keeps the `overscroll-contain` class, which the guided tour uses to find it.
 */
export function ScrollPanel({ id, enabled = true, className, children }: { id: string; enabled?: boolean; className?: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [hints, setHints] = useState<ScrollHints>({ above: false, below: false })
  const [label, setLabel] = useState('More below')
  const [footer, setFooter] = useState(0)
  const pill = useRef<HTMLButtonElement>(null)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const h = scrollHints(el.scrollTop, el.clientHeight, el.scrollHeight)
    setHints((p) => (p.above === h.above && p.below === h.below ? p : h))
    // a sticky action bar at the bottom of a panel (its own CTA) must stay clear of the pill and the fade
    const sticky = el.querySelector<HTMLElement>('.sticky.bottom-0')
    setFooter(sticky ? sticky.offsetHeight : 0)
    if (h.below) {
      const box = el.getBoundingClientRect()
      const items = [...el.querySelectorAll<HTMLElement>('h3, [data-section]')].map((n) => ({ title: n.textContent ?? '', top: n.getBoundingClientRect().top }))
      setLabel(pillLabel(nextSectionTitle(items, box.bottom - (sticky?.offsetHeight ?? 0))))
    }
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el || !enabled) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [measure, enabled, id])

  // one-time nudge per panel and session: a short bounce of the content plus a pulse on the pill
  useEffect(() => {
    if (!enabled || !hints.below || nudged.has(id)) return
    nudged.add(id)
    if (reduced()) return
    pill.current?.classList.add('pill-pulse')
    scroller.current?.firstElementChild?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }], {
      duration: 700,
      easing: 'ease-in-out',
      delay: 400,
    })
    const t = setTimeout(() => pill.current?.classList.remove('pill-pulse'), 2600)
    return () => clearTimeout(t)
  }, [enabled, hints.below, id])

  const pageDown = () => {
    const el = scroller.current
    if (!el) return
    el.scrollTo({ top: pageDownTarget(el.scrollTop, el.clientHeight, el.scrollHeight), behavior: reduced() ? 'auto' : 'smooth' })
  }

  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={scroller}
        onScroll={measure}
        data-scroller
        className="scroll-visible h-full overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        {children}
      </div>
      {enabled && (
        <>
          <div
            aria-hidden="true"
            className={cn('pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-card to-transparent transition-opacity duration-150', hints.above ? 'opacity-100' : 'opacity-0')}
          />
          <div
            aria-hidden="true"
            style={{ bottom: footer }}
            className={cn('pointer-events-none absolute inset-x-0 h-14 bg-gradient-to-t from-card to-transparent transition-opacity duration-150', hints.below ? 'opacity-100' : 'opacity-0')}
          />
          {hints.below && (
            <button
              ref={pill}
              type="button"
              onClick={pageDown}
              aria-label={label === 'More below' ? 'Scroll down for more options' : `Scroll down to ${label}`}
              style={{ bottom: footer + 12 }}
              className={cn(
                'absolute left-1/2 z-10 inline-flex h-9 max-w-[85%] -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-popover px-3.5 text-sm font-medium text-foreground shadow-float outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <span className="truncate">{label}</span>
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </div>
  )
}
