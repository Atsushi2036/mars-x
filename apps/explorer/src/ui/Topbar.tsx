import { CircleHelp, Moon, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useApp } from '@/store/app'
import { LogoMark } from './Logo'
import { MODES } from './modes'
import { Slot } from './slots'

export function Topbar() {
  const mode = useApp((s) => s.mode)
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const setOnboardingOpen = useApp((s) => s.setOnboardingOpen)
  const ds = useApp((s) => s.dataset)
  const label = MODES.find((m) => m.id === mode)?.label ?? ''
  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-3 border-b border-border/70 bg-background/80 px-3 backdrop-blur-md md:px-4">
      <LogoMark className="size-7 md:hidden" />
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight">MARS-X</span>
        <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
          /
        </span>
        <nav aria-label="Breadcrumb" className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
          Jezero crater <span aria-hidden="true">/</span> <span className="text-foreground">{label}</span>
        </nav>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Slot name="topbar:right" />
        {ds?.synthetic && (
          <Badge variant="outline" className="h-6 gap-1.5 border-input text-muted-foreground">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
            <span className="hidden sm:inline">Synthetic terrain, not real Mars data</span>
            <span className="sm:hidden">Synthetic</span>
          </Badge>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Show tips" onClick={() => setOnboardingOpen(true)} className="size-9 md:size-8">
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
              className="size-9 md:size-8"
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
