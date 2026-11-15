import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useTour } from '@/features/guided/store'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { cameraRig, flyTo, useCamera } from '@/store/camera'
import { useMission } from '@/store/mission'
import { usePlayback } from '@/store/playback'
import { Hand } from '../icons'
import { canGoto, isPicking, stepsFor, STEP_LABEL, type WizardStep } from './machine'
import { selectPicking, useWizard } from './store'

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A short buzz when a point is placed (phones). Not every browser has it, and it can throw. */
function buzz() {
  try {
    navigator.vibrate?.(18)
  } catch {
    /* no haptics */
  }
}

/** Overhead view of the whole tile: every point is easy to hit, and the sheet is out of the way. */
function frameWholeTile() {
  const ds = useApp.getState().dataset
  useCamera.getState().setMode('orbit')
  const ext = ds?.heightfield.extent
  const half = ext ? Math.max(ext.xMax - ext.xMin, ext.zMax - ext.zMin) / 2 : 500
  const fov = ((cameraRig.pose.fovDeg || 55) * Math.PI) / 180
  const aspect = Math.min(1, window.innerWidth / Math.max(1, window.innerHeight))
  const dist = Math.min(2300, Math.max(300, (half / (Math.tan(fov / 2) * aspect)) * 0.9))
  flyTo({ x: 0, z: 0, dist, yaw: 0, pitch: 1.35 }, reduced() ? 0 : 900)
}

/** Side effects of the wizard: auto-start, map-tap steps, advancing on a placed point, the journey and its exit. */
function useWizardSync() {
  // 1. entering Plan a route with nothing planned starts the wizard; leaving the mode ends it
  useEffect(() => {
    let wasOpen = false
    return useApp.subscribe((s) => {
      const open = s.mode === 'mission' && s.inspectorOpen
      const w = useWizard.getState()
      const m = useMission.getState()
      if (open && !wasOpen && !w.active && !m.origin && !m.destination && !useTour.getState().active) w.dispatch({ type: 'begin' })
      wasOpen = open
      if (w.active && !w.journey && s.mode !== 'mission') w.dispatch({ type: 'cancel' })
    })
  }, [])

  // the guided tour drives Plan a route itself (and expects the full panel): the wizard steps aside
  useEffect(
    () =>
      useTour.subscribe((t) => {
        if (t.active && useWizard.getState().active) useWizard.getState().dispatch({ type: 'cancel' })
      }),
    [],
  )

  // 2. a placed point advances the wizard
  useEffect(
    () =>
      useMission.subscribe((s, prev) => {
        const w = useWizard.getState()
        if (!w.active || w.journey) return
        const o = s.origin !== prev.origin && !!s.origin
        const d = s.destination !== prev.destination && !!s.destination
        if (o && d) w.dispatch({ type: 'endpointsSet' })
        else if (o) {
          if (isPicking(w)) buzz()
          w.dispatch({ type: 'originPlaced' })
        } else if (d) {
          if (isPicking(w)) buzz()
          w.dispatch({ type: 'destinationPlaced' })
        }
        // the profile can change the steps (Options is astronaut only)
        if (w.step === 'options' && s.profile !== 'astronaut') w.dispatch({ type: 'next' })
      }),
    [],
  )

  // 3. what each step does to the view
  const step = useWizard((s) => s.step)
  const active = useWizard((s) => s.active)
  const journey = useWizard((s) => s.journey)
  const picking = useWizard(selectPicking)
  const open = useApp((s) => s.inspectorOpen)
  const mode = useApp((s) => s.mode)

  useEffect(() => {
    document.body.toggleAttribute('data-wizard-pick', picking)
    return () => document.body.removeAttribute('data-wizard-pick')
  }, [picking])

  useEffect(() => {
    if (!active) return
    const ds = useApp.getState().dataset
    if (ds) void useMission.getState().ensureLayers(ds)
  }, [active])

  useEffect(() => {
    if (!picking) return
    useMission.getState().setPlacing(step === 'start' ? 'origin' : 'destination')
  }, [picking, step])

  // phones: while picking, the sheet gets out of the way (the banner replaces it); re-closes if something reopens it
  useEffect(() => {
    if (picking && !isDesktop() && open) useApp.getState().setInspectorOpen(false)
  }, [picking, open, step])

  // overhead view once per picking step; back to the usual view when the panel steps come back
  useEffect(() => {
    if (picking) frameWholeTile()
  }, [picking, step])
  const wasPickingRef = useRef(false)
  useEffect(() => {
    if (picking) {
      wasPickingRef.current = true
      return
    }
    if (!active || journey || !wasPickingRef.current) return
    wasPickingRef.current = false
    cameraRig.home()
    if (!useApp.getState().inspectorOpen || mode !== 'mission') useApp.getState().setMode('mission')
    if (!isDesktop()) useApp.getState().setSheetSnap('half')
  }, [active, picking, journey, step, mode])

  // 4. the journey: Exit (button or Esc) ends playback, which returns to Review with the sheet back
  useEffect(
    () =>
      usePlayback.subscribe((s, prev) => {
        const w = useWizard.getState()
        if (!w.journey || !prev.source || s.source) return
        w.dispatch({ type: 'exit' })
        useApp.getState().setMode('mission')
        if (!isDesktop()) useApp.getState().setSheetSnap('half')
      }),
    [],
  )
}

/** 1-4/5 dots; a finished step can be tapped to go back to it. */
export function WizardStepper({ className }: { className?: string }) {
  const step = useWizard((s) => s.step)
  const profile = useMission((s) => s.profile)
  const origin = useMission((s) => s.origin)
  const destination = useMission((s) => s.destination)
  const dispatch = useWizard((s) => s.dispatch)
  const steps = stepsFor(profile)
  const cur = steps.indexOf(step)
  const ctx = { hasOrigin: !!origin, hasDestination: !!destination, profile }
  return (
    <ol className={cn('flex items-center', className)} aria-label="Route steps">
      {steps.map((s: WizardStep, i) => {
        const done = i < cur
        const here = i === cur
        const can = !here && canGoto(s, ctx)
        return (
          <li key={s} className="flex flex-1 items-center last:flex-none" aria-current={here ? 'step' : undefined}>
            <button
              type="button"
              disabled={!can}
              onClick={() => dispatch({ type: 'goto', step: s })}
              aria-label={`${i + 1}. ${STEP_LABEL[s]}${done ? ', done' : ''}`}
              className="group flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold transition-colors',
                  done ? 'border-primary bg-primary text-primary-foreground' : here ? 'border-brand bg-brand text-brand-foreground' : 'border-border text-muted-foreground',
                )}
              >
                {i + 1}
              </span>
              {here && <span className="pr-1 text-sm font-medium">{STEP_LABEL[s]}</span>}
            </button>
            {i < steps.length - 1 && <span className={cn('h-px min-w-2 flex-1', done ? 'bg-primary' : 'bg-border')} aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

/** Floating banner over the map while a point is expected: what to tap, Back and Cancel. Never collapses the desktop panel. */
function PickBanner() {
  const step = useWizard((s) => s.step)
  const dispatch = useWizard((s) => s.dispatch)
  const destination = useMission((s) => s.destination)
  const notice = useMission((s) => s.placeNotice)
  const start = step === 'start'
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass pointer-events-auto absolute z-30 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 flex-col gap-1 rounded-2xl p-2 pl-3 text-card-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2"
      style={{ top: 'calc(var(--cover-top) + 10px)', left: 'calc((100% - var(--cover-right)) / 2)' }}
    >
      <WizardStepper />
      <div className="flex items-center gap-3 pb-1">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground" aria-hidden="true">
          <Hand className="size-5" strokeWidth={1.75} />
        </span>
        <p className="min-w-0 flex-1 text-base font-semibold leading-tight">
          Tap the map to set <span className="text-brand">{start ? 'START' : 'GOAL'}</span>
        </p>
      </div>
      {notice && (
        <p role="alert" className="rounded-lg bg-warning/15 px-3 py-2 text-sm font-medium text-foreground">
          {notice}
        </p>
      )}
      <div className="flex items-center gap-2 pb-1">
        <Button variant="outline" className="h-11 flex-1" onClick={() => dispatch({ type: 'back' })}>
          {start ? 'Cancel' : 'Back'}
        </Button>
        {!start && destination && (
          <Button variant="secondary" className="h-11 flex-1" onClick={() => dispatch({ type: 'destinationPlaced' })}>
            Keep goal
          </Button>
        )}
        {!start && (
          <Button variant="ghost" className="h-11" onClick={() => dispatch({ type: 'cancel' })}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

/** Mounted once in the shell: runs the wizard side effects and shows the map banner while picking. */
export function PlanWizard() {
  useWizardSync()
  const picking = useWizard(selectPicking)
  const ready = useApp((s) => s.progress.ready >= 1)
  if (!picking || !ready) return null
  return <PickBanner />
}
