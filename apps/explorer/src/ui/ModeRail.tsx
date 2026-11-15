import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { LogoMark } from '@/ui/Logo'
import { RAIL_MODES, railIdFor } from './modes'

/**
 * Desktop: 88 px dark rail, every item an icon over its task name (no tooltip-only names).
 * Phones: 64 px bottom bar with the short names. Same data, same store.
 */
export function ModeRail() {
  const mode = useApp((s) => s.mode)
  const open = useApp((s) => s.inspectorOpen)
  const setMode = useApp((s) => s.setMode)
  const setOpen = useApp((s) => s.setInspectorOpen)
  const lit = railIdFor(mode)

  const choose = (id: (typeof RAIL_MODES)[number]['id']) => {
    if (id === lit && open) setOpen(false)
    else setMode(id)
  }

  // the amber bar slides between items: measure the lit button, animate a transform
  const group = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ y: number; on: boolean }>({ y: 0, on: false })
  useLayoutEffect(() => {
    const el = group.current?.querySelector<HTMLElement>('[data-lit="true"]')
    if (!el) return setBar({ y: 0, on: false })
    const y = el.getBoundingClientRect().top - group.current!.getBoundingClientRect().top
    setBar({ y: y + (el.offsetHeight - 32) / 2, on: open })
  }, [lit, open])

  return (
    <>
      <nav
        aria-label="Modes"
        className="relative z-30 hidden w-[88px] shrink-0 flex-col items-center border-r border-rail-border bg-rail py-4 md:flex"
      >
        <button
          type="button"
          aria-label="MARS-X, back to Explore"
          onClick={() => setMode('explore')}
          className="mb-5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <LogoMark className="size-10" />
        </button>
        <div ref={group} className="relative flex w-full flex-col items-center gap-1">
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 h-8 w-[3px] rounded-r-full bg-brand transition-[transform,opacity] duration-200 ease-[var(--ease-out)]"
            style={{ transform: `translateY(${bar.y}px)`, opacity: bar.on ? 1 : 0 }}
          />
          {RAIL_MODES.map((m, i) => {
            const active = m.id === lit && open
            return (
              <div key={m.id} className="flex w-full flex-col items-center gap-1">
                {(i === 1 || i === 3) && <div className="my-2 h-px w-10 bg-rail-border" aria-hidden="true" />}
                <button
                  type="button"
                  aria-current={m.id === lit ? 'page' : undefined}
                  aria-pressed={active}
                  data-mode={m.id}
                  data-lit={m.id === lit}
                  onClick={() => choose(m.id)}
                  className={cn(
                    'flex h-16 w-[72px] flex-col items-center justify-center gap-1 rounded-xl text-rail-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-rail-accent/60 hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.97]',
                    active && 'bg-rail-accent text-white',
                  )}
                >
                  <m.icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
                  <span className="max-w-full truncate px-1 text-[12.5px] font-medium leading-4">{m.label}</span>
                </button>
              </div>
            )
          })}
        </div>
      </nav>

      <nav
        aria-label="Modes"
        data-chrome="bottom"
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-rail-border bg-rail pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {RAIL_MODES.map((m) => {
          const active = m.id === lit && open
          return (
            <button
              key={m.id}
              type="button"
              data-mode={m.id}
              aria-current={m.id === lit ? 'page' : undefined}
              aria-pressed={active}
              onClick={() => choose(m.id)}
              className={cn(
                'relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-rail-foreground outline-none transition-colors focus-visible:bg-rail-accent',
                active && 'text-white',
              )}
            >
              {active && <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-brand" aria-hidden="true" />}
              <m.icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
              <span className="max-w-full truncate px-1">{m.shortLabel}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
