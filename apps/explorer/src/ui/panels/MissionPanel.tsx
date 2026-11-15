import { useEffect, useRef } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PROFILES } from '@/intelligence/nav/profiles'
import { fmtInt, fmtLat, fmtLon } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { useMission, type MissionProfile } from '@/store/mission'
import { roverLive } from '@/store/rover'
import { AstronautIcon, Check, CircleAlert, Flag, MapPin, Play, RoverIcon, Trash2, type LucideIcon } from '../icons'
import { Chip, Details, EmptyState, Metric, PanelSection, Segmented, StatCard } from '../kit'
import { MarswalkReport, MarswalkSetup } from './MarswalkPanel'
import { pickSampleRoute } from './sample-route'
import { beginJourney } from '../wizard/journey'
import { DriverPicker } from '../nav/DriverPicker'
import { useWizard } from '../wizard/store'
import { WizardPanel } from '../wizard/WizardPanel'

const PROFILE_LABEL: Record<MissionProfile, string> = { astronaut: 'Astronaut', 'rover-rtg': 'Rover RTG', 'rover-solar': 'Rover solar' }
const PROFILE_ICON: Record<MissionProfile, LucideIcon> = { astronaut: AstronautIcon, 'rover-rtg': RoverIcon, 'rover-solar': RoverIcon }

/** Start, goal, plan: this one really is a sequence, so the steps are numbered and show a tick when done. */
function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const items = ['Start', 'Goal', 'Plan'] as const
  return (
    <ol className="flex items-center gap-2" aria-label="Steps">
      {items.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3
        const done = n < step || (n === 3 && step === 3)
        const current = n === step && n !== 3
        return (
          <li key={label} aria-current={current ? 'step' : undefined} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                done ? 'border-primary bg-primary text-primary-foreground' : current ? 'border-brand bg-brand/15 text-foreground' : 'border-border text-muted-foreground',
              )}
            >
              {done ? <Check className="size-4" strokeWidth={2.25} aria-hidden="true" /> : n}
            </span>
            <span className={cn('text-sm', current || done ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
            {i < 2 && <span className="h-px flex-1 bg-border" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

function Endpoint({ label, icon: Icon, at, active, onPick }: { label: string; icon: LucideIcon; at: { x: number; z: number } | null; active: boolean; onPick: () => void }) {
  const ds = useApp((s) => s.dataset)
  const ll = at && ds ? ds.heightfield.worldToLonLat(at.x, at.z) : null
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={cn(
        'flex min-h-16 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-brand bg-brand/10' : 'border-border hover:bg-muted',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-5 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
        {label}
      </span>
      <span className="w-full truncate text-xs tabular-nums text-muted-foreground">{ll ? `${fmtLat(ll.lat)} ${fmtLon(ll.lon)}` : active ? 'Tap the terrain' : 'Not set'}</span>
    </button>
  )
}

/** Three horizontal bars: distance per profile. One idea, one hue (planner cyan), the chosen profile in full colour. */
function CompareProfiles() {
  const m = useMission()
  const rows = (Object.keys(PROFILE_LABEL) as MissionProfile[]).map((id) => ({ id, o: m.outcomes[id] }))
  const max = Math.max(1, ...rows.map((r) => (r.o?.status === 'ok' ? r.o.stats.lengthM : 0)))
  return (
    <ul className="space-y-2" aria-label="Distance by profile">
      {rows.map(({ id, o }) => {
        const ok = o?.status === 'ok'
        return (
          <li key={id} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
            <span className={cn(id === m.profile ? 'font-medium text-foreground' : 'text-muted-foreground')}>{PROFILE_LABEL[id]}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-muted">
              {ok && <span className={cn('block h-full rounded-full', id === m.profile ? 'bg-planner' : 'bg-planner/45')} style={{ width: `${(o.stats.lengthM / max) * 100}%` }} />}
            </span>
            <span className="w-24 text-right tabular-nums text-muted-foreground">{ok ? `${fmtInt(o.stats.lengthM)} m · ${o.stats.maxSlopeDeg.toFixed(0)}°` : o ? 'No route' : '—'}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Puts a start near the rover and a goal 300 m or more away over connected gentle ground, so there is something to plan. */
function useSampleRoute() {
  const ds = useApp((s) => s.dataset)
  const place = useMission((s) => s.place)
  const setPlacing = useMission((s) => s.setPlacing)
  return () => {
    const layers = useMission.getState().layers
    if (!ds || !layers) return
    const pick = pickSampleRoute(layers, { x: roverLive.x, z: roverLive.z })
    if (!pick) return
    setPlacing('origin')
    place(ds, pick.origin)
    place(ds, pick.destination)
  }
}

function MissionPanelClassic() {
  const ds = useApp((s) => s.dataset)
  const m = useMission()
  const sample = useSampleRoute()
  const { ensureLayers } = m
  useEffect(() => {
    if (ds) void ensureLayers(ds)
  }, [ds, ensureLayers])

  const outcome = m.outcomes[m.profile]
  const resultRef = useRef<HTMLDivElement>(null)
  // only on the phone sheet (the result can sit below the fold); on desktop the panel keeps its place so the header stays visible
  useEffect(() => {
    if (outcome && !window.matchMedia('(min-width: 768px)').matches) resultRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [outcome])
  const both = !!m.origin && !!m.destination
  const step: 1 | 2 | 3 = !m.origin ? 1 : !m.destination ? 2 : 3
  const limit = m.profile === 'astronaut' ? m.astronautSlopeLimit : PROFILES[m.profile].maxSlope
  const sourced = PROFILES[m.profile].provenance === 'sourced'

  return (
    <div>
      <PanelSection>
        <Stepper step={step} />
        <div className="grid grid-cols-[1fr_1fr_auto] items-stretch gap-2">
          <Endpoint label="Origin" icon={MapPin} at={m.origin} active={m.placing === 'origin'} onPick={() => m.setPlacing('origin')} />
          <Endpoint label="Destination" icon={Flag} at={m.destination} active={m.placing === 'destination'} onPick={() => m.setPlacing('destination')} />
          <Button variant="ghost" size="icon" aria-label="Clear endpoints" className="size-11 self-center" disabled={!m.origin && !m.destination} onClick={m.clear}>
            <Trash2 className="size-5" />
          </Button>
        </div>
      </PanelSection>

      <PanelSection title="Who is travelling">
        <Segmented<MissionProfile>
          label="Traverse profile"
          stacked
          value={m.profile}
          onChange={m.setProfile}
          options={(Object.keys(PROFILE_LABEL) as MissionProfile[]).map((id) => ({ value: id, label: PROFILE_LABEL[id], icon: PROFILE_ICON[id], sub: `Limit ${id === 'astronaut' ? m.astronautSlopeLimit : PROFILES[id].maxSlope}°` }))}
        />
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Chip tone={sourced ? 'success' : 'neutral'} className="h-6">
            {sourced ? 'sourced limit' : 'assumption'}
          </Chip>
          {sourced ? 'Slope limit from the vehicle documentation.' : 'Editable later in Test your AI.'}
        </p>
      </PanelSection>

      {m.profile === 'astronaut' && <MarswalkSetup />}

      <PanelSection title="Route">
        {m.layersStatus === 'loading' && (
          <div className="space-y-2" role="status" aria-label="Loading planning layers">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {m.layersStatus === 'error' && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Planning layers failed to load</AlertTitle>
            <AlertDescription>{m.layersError}</AlertDescription>
          </Alert>
        )}
        {m.layersStatus === 'ready' && !both && (
          <EmptyState
            art="route"
            title={m.origin ? 'Now pick the goal' : 'Pick a start and a goal'}
            line={m.origin ? 'Tap the terrain to place the destination.' : 'Tap the terrain to place your start.'}
            cta={
              <div className="flex w-full flex-col gap-2">
                <Button className="h-11 w-full" onClick={() => useWizard.getState().dispatch({ type: 'begin' })}>
                  Plan step by step
                </Button>
                <Button variant="ghost" className="h-11 w-full" onClick={sample}>
                  Use a sample route
                </Button>
              </div>
            }
          />
        )}
        {m.layersStatus === 'ready' && both && m.planning && !outcome && (
          <div className="grid grid-cols-2 gap-2" role="status" aria-label="Planning">
            <Skeleton className="h-[92px] rounded-2xl" />
            <Skeleton className="h-[92px] rounded-2xl" />
          </div>
        )}
        <div ref={resultRef} className="scroll-mb-3 space-y-3">
          {outcome?.status === 'ok' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatCard label="Distance" value={fmtInt(outcome.stats.lengthM)} unit="m" provenance="derived" />
                <StatCard
                  label="Max slope"
                  value={outcome.stats.maxSlopeDeg.toFixed(1)}
                  unit="°"
                  provenance="derived"
                  gauge={{ value: outcome.stats.maxSlopeDeg, limit, label: `Max slope against the ${limit} degree limit` }}
                  sub={`limit ${limit}°`}
                />
                <StatCard label="Climb" value={fmtInt(outcome.stats.climbM)} unit="m" provenance="derived" />
                <StatCard label="Mean slope" value={outcome.stats.meanSlopeDeg.toFixed(1)} unit="°" provenance="derived" />
              </div>
              <DriverPicker />
              <Button className="h-12 w-full bg-brand text-base font-semibold text-brand-foreground hover:bg-brand/90" onClick={() => beginJourney()}>
                <Play className="size-5" aria-hidden="true" />
                Watch the journey
              </Button>
              <Details summary="Details">
                <dl className="divide-y divide-border">
                  <Metric label="Nodes expanded" value={fmtInt(outcome.expanded)} />
                  <Metric label="Planned in" value={`${outcome.ms.toFixed(0)} ms`} />
                  {m.layers && <Metric label="Grid" value={`${m.layers.grid.res} m, ${m.layers.origin === 'pipeline' ? 'worst-case slope per cell' : 'slope from elevation'}`} />}
                </dl>
              </Details>
            </>
          )}
          {outcome && outcome.status !== 'ok' && (
            <Alert variant="destructive" role="alert">
              <CircleAlert />
              <AlertTitle>{outcome.status === 'no-route' ? 'No route for this profile' : 'Planner error'}</AlertTitle>
              <AlertDescription>{outcome.message}</AlertDescription>
            </Alert>
          )}
        </div>
      </PanelSection>

      {m.profile === 'astronaut' && <MarswalkReport />}

      {both && Object.keys(m.outcomes).length > 0 && (
        <PanelSection title="Compare profiles">
          <CompareProfiles />
        </PanelSection>
      )}
    </div>
  )
}

/** Plan a route: the step-by-step wizard while it runs, the full panel otherwise (editing an existing plan). */
export function MissionPanel() {
  const wizard = useWizard((s) => s.active && !s.journey)
  return wizard ? <WizardPanel /> : <MissionPanelClassic />
}
