import { X } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useApp } from '@/store/app'
import { useMission } from '@/store/mission'
import { MODES } from './modes'
import { PanelSlot } from './slots'
import { DataPanel } from './panels/DataPanel'
import { ExplorePanel } from './panels/ExplorePanel'
import { LayersPanel } from './panels/LayersPanel'
import { LabPanel } from './panels/EmptyPanels'
import { MissionPanel } from './panels/MissionPanel'

function PanelBody() {
  const mode = useApp((s) => s.mode)
  switch (mode) {
    case 'explore':
      return <PanelSlot name="panel:explore" builtin={<ExplorePanel />} />
    case 'layers':
      return <PanelSlot name="panel:layers" builtin={<LayersPanel />} />
    case 'mission':
      return <PanelSlot name="panel:mission" builtin={<MissionPanel />} />
    case 'lab':
      return <PanelSlot name="panel:lab" builtin={<LabPanel />} />
    case 'data':
      return <PanelSlot name="panel:data" builtin={<DataPanel />} />
  }
}

function Header() {
  const mode = useApp((s) => s.mode)
  const setOpen = useApp((s) => s.setInspectorOpen)
  const def = MODES.find((m) => m.id === mode)!
  return (
    <div className="flex items-start gap-3 border-b border-border px-4 py-3">
      <def.icon className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold leading-5">{def.label}</h2>
        <p className="text-xs leading-4 text-muted-foreground">{def.blurb}</p>
      </div>
      <Button variant="ghost" size="icon" aria-label="Close panel" className="-mr-1.5 -mt-1 size-9 md:size-7" onClick={() => setOpen(false)}>
        <X />
      </Button>
    </div>
  )
}

/** Drag/tap handle of the mobile sheet: swipe up expands, swipe down collapses (then closes), tap toggles. */
function SheetHandle() {
  const expanded = useApp((s) => s.sheetExpanded)
  const setExpanded = useApp((s) => s.setSheetExpanded)
  const setOpen = useApp((s) => s.setInspectorOpen)
  const y0 = useRef<number | null>(null)
  return (
    <button
      type="button"
      aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
      aria-expanded={expanded}
      className="mx-auto flex h-7 w-24 shrink-0 touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(e) => {
        y0.current = e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerUp={(e) => {
        const d = y0.current === null ? 0 : e.clientY - y0.current
        y0.current = null
        if (d < -24) setExpanded(true)
        else if (d > 24) {
          if (expanded) setExpanded(false)
          else setOpen(false)
        }
        else setExpanded(!expanded)
      }}
    >
      <span className="h-1 w-9 rounded-full bg-border" aria-hidden="true" />
    </button>
  )
}

const DESKTOP = '(min-width: 768px)'
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DESKTOP)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  )
}

/**
 * Desktop: floating card docked on the right. Mobile: non-modal bottom sheet that starts as a peek and rises by itself
 * to the middle height when a Mission result arrives. Only ONE aside is mounted at a time, so `[aria-label="Inspector"]`
 * is always the visible one (two copies of the panels would also duplicate every control id).
 */
export function Inspector() {
  const open = useApp((s) => s.inspectorOpen)
  const expanded = useApp((s) => s.sheetExpanded)
  const desktop = useIsDesktop()
  const results = useMission((s) => Object.keys(s.outcomes).length)
  const setExpanded = useApp((s) => s.setSheetExpanded)
  // a new Mission result (distance, or "No route") must not stay hidden under the peek height
  useEffect(() => {
    if (results > 0 && !desktop) setExpanded(true)
  }, [results, desktop, setExpanded])
  if (!open) return null
  if (desktop) {
    return (
      <aside
        aria-label="Inspector"
        className="pointer-events-auto absolute right-3 top-[3.75rem] z-20 flex h-[min(calc(100%-6.5rem),52rem)] w-80 flex-col overflow-hidden rounded-xl border border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-md"
      >
        <Header />
        <ScrollArea className="min-h-0 flex-1">
          <PanelBody />
        </ScrollArea>
      </aside>
    )
  }
  return (
    <aside
      aria-label="Inspector"
      data-cover="bottom"
      className={`pointer-events-auto fixed inset-x-0 bottom-[7.25rem] z-20 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-md transition-[height] duration-200 ${expanded ? 'h-[52dvh]' : 'h-[14.5rem]'}`}
    >
      <SheetHandle />
      <Header />
      <div className={`min-h-0 flex-1 overscroll-contain ${expanded ? 'overflow-y-auto' : 'overflow-hidden'}`}>
        <PanelBody />
      </div>
    </aside>
  )
}
