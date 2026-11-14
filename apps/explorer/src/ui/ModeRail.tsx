import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { LogoMark } from './Logo'
import { MODES } from './modes'

/** Desktop: vertical dark rail. Mobile: bottom navigation bar. Same data, same store. */
export function ModeRail() {
  const mode = useApp((s) => s.mode)
  const open = useApp((s) => s.inspectorOpen)
  const setMode = useApp((s) => s.setMode)
  const setOpen = useApp((s) => s.setInspectorOpen)

  const choose = (id: (typeof MODES)[number]['id']) => {
    if (id === mode && open) setOpen(false)
    else setMode(id)
  }

  return (
    <>
      <nav
        aria-label="Modes"
        className="relative z-30 hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-rail-border bg-rail py-3 md:flex"
      >
        <LogoMark className="mb-3 size-8" />
        {MODES.map((m) => {
          const active = m.id === mode && open
          return (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={m.label}
                  aria-current={m.id === mode ? 'page' : undefined}
                  aria-pressed={active}
                  onClick={() => choose(m.id)}
                  className={cn(
                    'relative grid size-10 place-items-center rounded-lg text-rail-foreground outline-none transition-colors hover:bg-rail-accent hover:text-white focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    m.id === mode && 'bg-rail-accent text-white',
                  )}
                >
                  {m.id === mode && <span className="absolute -left-2 h-5 w-0.5 rounded-full bg-sidebar-primary" />}
                  <m.icon className="size-5" strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{m.label}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>

      <nav
        aria-label="Modes"
        className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-rail-border bg-rail pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-current={m.id === mode ? 'page' : undefined}
            onClick={() => choose(m.id)}
            className={cn(
              'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-rail-foreground outline-none transition-colors focus-visible:bg-rail-accent',
              m.id === mode && 'text-sidebar-primary',
            )}
          >
            <m.icon className="size-5" strokeWidth={1.75} />
            <span className="max-w-full truncate px-1">{m.id === 'data' ? 'Data' : m.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}
