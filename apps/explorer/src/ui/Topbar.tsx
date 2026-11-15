import { CircleHelp, MapPin, Moon, Sun } from '@/ui/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useScenario } from '@/features/scenario/store'
import { useApp } from '@/store/app'
import { LogoMark, LogoWordmark } from '@/ui/Logo'
import { Slot } from './slots'

/** Local mean solar time in hours (14.5) to "14:30". */
export function fmtClock(h: number): string {
  const total = Math.round((((h % 24) + 24) % 24) * 60)
  const hh = Math.floor(total / 60) % 24
  return `${String(hh).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Where and when the view is, in one chip. Opens Explore, where sol and time are set. */
function ContextChip() {
  const sol = useScenario((s) => s.sol)
  const lmst = useScenario((s) => s.lmstH)
  const setMode = useApp((s) => s.setMode)
  return (
    <button
      type="button"
      onClick={() => setMode('explore')}
      aria-label="Change place, sol and time (opens Explore)"
      className="hidden h-9 items-center gap-2 rounded-full border border-border bg-muted/60 px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
    >
      <MapPin className="size-4 text-primary" aria-hidden="true" />
      <span>Jezero</span>
      {sol !== null && (
        <>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums">Sol {sol}</span>
          <span className="text-muted-foreground" aria-hidden="true">
            ·
          </span>
          <span className="tabular-nums">{fmtClock(lmst)}</span>
        </>
      )}
    </button>
  )
}

export function Topbar() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const setOnboardingOpen = useApp((s) => s.setOnboardingOpen)
  const ds = useApp((s) => s.dataset)
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <header
      data-chrome="top"
      className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-3 border-b border-border bg-background/90 px-3 backdrop-blur-md md:h-14 md:px-4"
    >
      <LogoMark className="size-8 md:hidden" />
      <LogoWordmark className="hidden h-5 w-auto text-foreground min-[400px]:block md:h-[22px]" />
      <ContextChip />
      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        {ds?.synthetic && (
          <Badge variant="outline" className="h-7 gap-1.5 border-input px-2.5 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
            <span className="hidden sm:inline">Synthetic terrain, not real Mars data</span>
            <span className="sm:hidden">Synthetic</span>
          </Badge>
        )}
        <Slot name="topbar:right" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Show tips" onClick={() => setOnboardingOpen(true)} className="size-10 [&_svg]:size-5">
              <CircleHelp />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Tips</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Switch to ${next} theme`}
              onClick={() => setTheme(next)}
              className="size-10 [&_svg]:size-5"
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
