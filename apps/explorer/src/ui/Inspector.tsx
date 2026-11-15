import { ChevronDown, X } from '@/ui/icons'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollPanel } from './ScrollPanel'
import { useWizard } from './wizard/store'
import { useImmersive } from './wizard/immersive'
import { useApp, type Mode } from '@/store/app'
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
  return (
    <div key={mode} className="panel-swap">
      <PanelFor mode={mode} />
    </div>
  )
}

function PanelFor({ mode }: { mode: Mode }) {
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

function Header({ compact = false }: { compact?: boolean }) {
  const mode = useApp((s) => s.mode)
  const setOpen = useApp((s) => s.setInspectorOpen)
  const def = MODES.find((m) => m.id === mode)!
  return (
    <div className={`flex items-center gap-3 border-b border-border px-4 ${compact ? 'pb-2' : 'py-4'}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary" aria-hidden="true">
        <def.icon className="size-6" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-semibold leading-tight">{def.title}</h2>
        {!compact && <p className="text-sm leading-5 text-muted-foreground">{def.subtitle}</p>}
      </div>
      <Button variant="ghost" size="icon" aria-label="Close panel" className="-mr-2 size-10 [&_svg]:size-5" onClick={() => setOpen(false)}>
        <X />
      </Button>
    </div>
  )
}

/** Drag/tap handle of the mobile sheet: swipe up expands, swipe down collapses (then closes), tap toggles. */
function SheetHandle() {
  const snap = useApp((s) => s.sheetSnap)
  const setSnap = useApp((s) => s.setSheetSnap)
  const setOpen = useApp((s) => s.setInspectorOpen)
  const y0 = useRef<number | null>(null)
  const up = { peek: 'half', half: 'full', full: 'full' } as const
  const down = { full: 'half', half: 'peek', peek: null } as const
  return (
    <button
      type="button"
      aria-label={snap === 'peek' ? 'Expand panel' : 'Collapse panel'}
      aria-expanded={snap !== 'peek'}
      className={`mx-auto flex w-40 shrink-0 touch-none flex-col items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring ${snap === 'peek' ? 'h-10 gap-0.5' : 'h-7'}`}
      onPointerDown={(e) => {
        y0.current = e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerUp={(e) => {
        const d = y0.current === null ? 0 : e.clientY - y0.current
        y0.current = null
        if (d < -24) setSnap(up[snap])
        else if (d > 24) {
          const n = down[snap]
          if (n) setSnap(n)
          else setOpen(false)
        } else setSnap(snap === 'peek' ? 'half' : 'peek')
      }}
    >
      <span className="h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
      {snap === 'peek' && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <ChevronDown className="size-3.5 rotate-180" aria-hidden="true" />
          Swipe up for more
        </span>
      )}
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
  const mode = useApp((s) => s.mode)
  const open = useApp((s) => s.inspectorOpen)
  const snap = useApp((s) => s.sheetSnap)
  const desktop = useIsDesktop()
  const results = useMission((s) => Object.keys(s.outcomes).length)
  const setExpanded = useApp((s) => s.setSheetExpanded)
  // a new Mission result (distance, or "No route") must not stay hidden under the peek height
  useEffect(() => {
    if (results > 0 && !desktop) setExpanded(true)
  }, [results, desktop, setExpanded])
  const journey = useImmersive()
  const wizardOn = useWizard((s) => s.active)
  if (!open || journey) return null
  if (desktop) {
    return (
      <aside
        aria-label="Inspector"
        data-chrome="side"
        className="glass pointer-events-auto absolute right-3 top-[calc(var(--cover-top)+12px)] bottom-[calc(var(--cover-bottom)+12px)] z-20 flex max-h-[52rem] w-96 flex-col overflow-hidden rounded-2xl text-card-foreground"
      >
        <Header />
        <ScrollPanel id={mode} className="flex-1">
          <PanelBody />
        </ScrollPanel>
      </aside>
    )
  }
  const height = { peek: 'h-40', half: 'h-[52dvh]', full: 'h-[min(88dvh,calc(100dvh-156px))]' }[snap]
  return (
    <aside
      aria-label="Inspector"
      data-cover="bottom"
      data-chrome="bottom"
      className={`glass pointer-events-auto fixed inset-x-0 bottom-24 z-20 flex flex-col overflow-hidden rounded-t-2xl border-b-0 text-card-foreground transition-[height] duration-[var(--dur-slow)] ease-[var(--ease-out)] ${height}`}
    >
      <SheetHandle />
      <Header compact={snap === 'peek' || (wizardOn && mode === 'mission')} />
      {snap === 'peek' ? (
        <div className="min-h-0 flex-1 overflow-hidden overscroll-contain [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
          <PanelBody />
        </div>
      ) : (
        <ScrollPanel id={mode} className="flex-1">
          <PanelBody />
        </ScrollPanel>
      )}
    </aside>
  )
}
