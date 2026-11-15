import { useEffect, useMemo, useRef } from 'react'
import { compareRoutes, marswalkReport, type WalkReport } from '@/core/mission/marswalk'
import { worldToCell } from '@/core/mission/geometry'
import type { Provenance } from '@/features/shared/provenance'
import { ENERGY } from '@/intelligence/sim/energy'
import { PROFILES } from '@/intelligence/nav/profiles'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { selectScienceTarget, useMission } from '@/store/mission'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Check, TriangleAlert } from '../icons'
import { Details, Learn, Metric, PanelSection, StatCard } from '../kit'

const f0 = (n: number) => Math.round(n).toLocaleString('en-US')
const minus = (s: string) => s.replace('-', '−')

/** h and min from seconds: "1 h 12 min", "38 min". */
export function fmtDuration(s: number): string {
  const neg = s < 0
  const m = Math.round(Math.abs(s) / 60)
  const h = Math.floor(m / 60)
  const body = h > 0 ? `${h} h ${String(m - h * 60).padStart(2, '0')} min` : `${m} min`
  return neg ? `−${body}` : body
}

function Line({ label, value, chip, note }: { label: string; value: string; chip: Provenance; note?: string }) {
  return (
    <div className="py-0.5">
      <Metric label={label} value={value} provenance={chip} />
      {note && <p className="-mt-1 pb-1 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Small segmented choice (no native select). */
function Choice({ label, value, options, unit, onChange }: { label: string; value: number; options: number[]; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span id={`choice-${label}`} className="text-muted-foreground">
        {label} ({unit === '°' ? 'degrees' : 'minutes'})
      </span>
      <ToggleGroup type="single" value={String(value)} onValueChange={(v) => v && onChange(Number(v))} variant="outline" spacing={0} aria-labelledby={`choice-${label}`}>
        {options.map((o) => (
          <ToggleGroupItem key={o} value={String(o)} className="h-10 min-w-11 px-2 text-sm tabular-nums">
            {o}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function Verdict({ ok, children }: { ok: boolean; children: string }) {
  const Icon = ok ? Check : TriangleAlert
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium',
        ok ? 'border-chart-3/40 bg-chart-3/10 text-foreground' : 'border-destructive/50 bg-destructive/10 text-foreground',
      )}
    >
      <Icon className={cn('size-5 shrink-0', ok ? 'text-chart-3' : 'text-destructive')} aria-hidden="true" />
      {children}
    </p>
  )
}

/** Science stop picker: Perseverance waypoints (real sol and measured tilt) and CRISM mineral patches. */
function ScienceStops() {
  const ds = useApp((s) => s.dataset)
  const targets = useMission((s) => s.scienceTargets)
  const status = useMission((s) => s.scienceStatus)
  const picked = useMission((s) => s.scienceTargetId)
  const origin = useMission((s) => s.origin)
  const ensure = useMission((s) => s.ensureScienceTargets)
  useEffect(() => {
    if (ds) void ensure(ds)
  }, [ds, ensure])

  const sorted = useMemo(() => {
    const o = origin ?? { x: 0, z: 0 }
    const d = (t: { x: number; z: number }) => Math.hypot(t.x - o.x, t.z - o.z)
    return [...targets].sort((a, b) => (a.kind === b.kind ? d(a) - d(b) : a.kind === 'mineral' ? -1 : 1))
  }, [targets, origin])
  const selected = targets.find((t) => t.id === picked)
  const list = useRef<HTMLUListElement>(null)
  // keep the picked stop visible inside the list (moves only the list, not the whole panel)
  useEffect(() => {
    const ul = list.current
    const el = ul?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (ul && el) ul.scrollTop = Math.max(0, el.offsetTop - ul.clientHeight / 2 + el.clientHeight / 2)
  }, [picked, sorted])

  return (
    <PanelSection title="Science stop" caption="Where the walk goes: a real Perseverance waypoint or a mineral patch; tap a diamond on the map.">
      {status === 'loading' && <p className="text-sm text-muted-foreground">Loading targets</p>}
      {status === 'ready' && targets.length === 0 && <p className="text-sm text-muted-foreground">No waypoints in this dataset.</p>}
      {sorted.length > 0 && (
        <ul ref={list} className="relative max-h-52 divide-y divide-border overflow-y-auto overscroll-contain rounded-xl border border-border" aria-label="Science stops, nearest first">
          {sorted.map((t) => {
            const on = t.id === picked
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => void selectScienceTarget(t.id)}
                  className={cn(
                    'flex min-h-11 w-full flex-col justify-center px-3 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    on ? 'bg-primary/10' : 'hover:bg-muted',
                  )}
                >
                  <span className="font-medium text-foreground">{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.detail}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected?.waypoint && (
        <div className="grid grid-cols-2 gap-2">
          <StatCard compact label="Sol of the visit" value={selected.waypoint.sol} provenance="measured" />
          <StatCard compact label="Measured tilt" value={minus(selected.waypoint.tiltDeg.toFixed(1))} unit="°" provenance="measured" sub="MMGIS" />
        </div>
      )}
      {selected?.kind === 'mineral' && <p className="text-xs text-muted-foreground">CRISM is a machine-learning product: a candidate, not a confirmed outcrop.</p>}
    </PanelSection>
  )
}

function EvaBudget({ r }: { r: WalkReport }) {
  const walk = useMission((s) => s.walk)
  const setWalk = useMission((s) => s.setWalk)
  return (
    <PanelSection title="EVA budget" caption="Round trip from the shelter to the stop and back.">
      <Verdict ok={r.withinBudget}>
        {r.withinBudget
          ? `Fits the ${walk.evaHours} h EVA with ${fmtDuration(r.marginS)} to spare`
          : r.marginS < 0
            ? `Over the ${walk.evaHours} h EVA by ${fmtDuration(-r.marginS)}`
            : 'Not enough consumables for the round trip'}
      </Verdict>
      <div className="grid grid-cols-3 gap-2">
        <StatCard compact label="Round trip" value={fmtDuration(r.roundTripS)} provenance="derived" />
        <StatCard compact label="Margin" value={minus(fmtDuration(r.marginS))} provenance="derived" sub={`${minus(r.marginPct.toFixed(0))}%`} />
        <StatCard compact label="Energy" value={f0(r.energyTotalWh)} unit="Wh" provenance="modeled" />
      </div>
      <Choice label="Time at the stop" value={walk.stopMin} options={[15, 30, 60, 90]} unit="min" onChange={(v) => setWalk({ stopMin: v })} />
      <Details summary="Assumptions and sources">
        <dl className="divide-y divide-border">
          <Line label="Route, one way" value={`${f0(r.distanceM)} m`} chip="derived" note="Planned on the 2 m grid over the real DEM." />
          <Line label="Walking speed" value={`${walk.speedMs} m/s`} chip="assumption" note="Suited walking speed; no measured value for Mars." />
          <Line label="Walk out and back" value={fmtDuration(r.outboundS + r.returnS)} chip="derived" />
          <Line label="Time at the stop" value={`${walk.stopMin} min`} chip="assumption" />
          <Line label="EVA duration" value={`${walk.evaHours} h`} chip="assumption" note="Typical planning length; adjustable in the SDK." />
          <Line
            label="Energy, round trip"
            value={`${f0(r.energyTotalWh)} Wh`}
            chip="modeled"
            note={`Metabolic rate ${f0(ENERGY.metRateLowW)} to ${f0(ENERGY.metRateHighW)} W by slope, about ${f0(r.avgKcalPerH)} kcal/h on average.`}
          />
          <Line label="Consumables" value={`${f0(r.consumablesWh)} Wh`} chip="assumption" note="4 h at the Apollo high rate of 302 kcal/h (1,200 BTU/h)." />
          <Line label="Metabolic rate" value="197-302 kcal/h" chip="measured" note="Apollo EVA data (780 to 1,200 BTU/h)." />
          <Line label="Longest one-way walk" value={`${f0(r.maxOneWayM)} m`} chip="derived" note="What the EVA time allows with this stop time." />
        </dl>
      </Details>
    </PanelSection>
  )
}

function ShelterRule({ r }: { r: WalkReport }) {
  const walk = useMission((s) => s.walk)
  const setWalk = useMission((s) => s.setWalk)
  const s = r.shelter
  return (
    <PanelSection
      title="Shelter rule"
      caption="Training rule, not a forecast."
      action={
        <Learn title="Solar particle alert">
          <p>If an alert sounds, the crew must be back at the shelter inside the window. The map draws in red the part of the route that is farther than that.</p>
        </Learn>
      }
    >
      <Verdict ok={s.unsafeFromM === null}>
        {s.unsafeFromM === null ? `All of the route is within ${walk.shelterMin} min of the shelter` : `${f0(s.unsafeM)} m of the route are more than ${walk.shelterMin} min from the shelter`}
      </Verdict>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Farthest safe" value={f0(s.maxSafeM)} unit="m" provenance="derived" sub={`${walk.shelterMin} min at ${walk.speedMs} m/s`} />
        <StatCard label="Beyond the window" value={f0(s.unsafeM)} unit="m" provenance="derived" />
      </div>
      <Choice label="Shelter window (assumption)" value={walk.shelterMin} options={[10, 15, 30, 45, 60]} unit="min" onChange={(v) => setWalk({ shelterMin: v })} />
    </PanelSection>
  )
}

/** Plain-language reason why the astronaut route is (or is not) different from the rover route. */
function WhyDifferent() {
  const outcomes = useMission((s) => s.outcomes)
  const layers = useMission((s) => s.layers)
  const limit = useMission((s) => s.astronautSlopeLimit)
  const astro = outcomes.astronaut
  const rover = outcomes['rover-rtg']
  const diff = useMemo(() => {
    if (!astro || astro.status !== 'ok' || !rover || rover.status !== 'ok' || !layers) return null
    const slopeAt = (x: number, z: number) => {
      const c = worldToCell(layers.grid, x, z)
      return c < 0 ? 0 : layers.slope[c]!
    }
    return { d: compareRoutes(astro.path, rover.path, slopeAt, limit), a: astro.stats, r: rover.stats }
  }, [astro, rover, layers, limit])
  if (!diff) return null
  const { d, a, r } = diff
  const same = d.overlapPct >= 90 && Math.abs(d.lengthDiffM) < 25
  return (
    <PanelSection>
      <Details summary="Why this differs from the rover route">
        <ul className="list-disc space-y-1.5 pl-4 text-sm leading-6 text-muted-foreground">
          <li>
            The astronaut stays under <span className="text-foreground">{limit}°</span> and the rover under <span className="text-foreground">{PROFILES['rover-rtg'].maxSlope}°</span>, and a walker pays more for slope
            (weight {PROFILES.astronaut.ws} against {PROFILES['rover-rtg'].ws}). Both limits are planning choices, not official limits.
          </li>
          <li>
            Astronaut route: {f0(a.lengthM)} m, steepest {a.maxSlopeDeg.toFixed(0)}°. Rover route: {f0(r.lengthM)} m, steepest {r.maxSlopeDeg.toFixed(0)}°.
          </li>
          {d.roverMetresAboveLimit > 0 ? (
            <li>
              The rover route runs <span className="text-foreground">{f0(d.roverMetresAboveLimit)} m</span> on slopes above the astronaut limit, so a person cannot take it.
            </li>
          ) : same ? (
            <li>On this stretch the terrain is gentle enough that both profiles choose almost the same line ({d.overlapPct.toFixed(0)}% shared). Try a stop across the dunes or near a scarp.</li>
          ) : (
            <li>The extra slope cost steers the walker onto smoother ground, {d.overlapPct.toFixed(0)}% of the line is shared.</li>
          )}
        </ul>
      </Details>
    </PanelSection>
  )
}

/** Marswalk set-up (limits and science stop), shown in Mission mode when the profile is Astronaut. */
export function MarswalkSetup() {
  const walk = useMission((s) => s.walk)
  const limit = useMission((s) => s.astronautSlopeLimit)
  const setLimit = useMission((s) => s.setAstronautSlopeLimit)
  // the waypoints are the stops: show them on the map while the crew plans
  useEffect(() => {
    if (!useApp.getState().showTraverse) useApp.getState().setShowTraverse(true)
  }, [])
  return (
    <>
      <PanelSection title="Astronaut limits" caption="Conservative for a suited crew; lunar studies cite 15 to 20°.">
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Slope limit" value={limit} unit="°" provenance="assumption" />
          <StatCard label="Walking speed" value={walk.speedMs} unit="m/s" provenance="assumption" />
        </div>
        <Choice label="Slope limit" value={limit} options={[10, 15, 20]} unit="°" onChange={setLimit} />
        <p className="text-xs text-muted-foreground">Steepest ground the astronaut may walk. Higher = shorter but riskier route.</p>
      </PanelSection>
      <ScienceStops />
    </>
  )
}

/** Marswalk results: EVA budget, shelter rule and why the route differs from the rover route. */
export function MarswalkReport() {
  const outcome = useMission((s) => s.outcomes.astronaut)
  const walk = useMission((s) => s.walk)
  const ds = useApp((s) => s.dataset)
  const limit = useMission((s) => s.astronautSlopeLimit)
  const report = useMemo(() => {
    if (!ds || !outcome || outcome.status !== 'ok') return null
    return marswalkReport(outcome.path, (x, z) => ds.heightfield.sampleHeight(x, z), walk)
  }, [ds, outcome, walk])
  if (report) {
    return (
      <>
        <EvaBudget r={report} />
        <ShelterRule r={report} />
        <WhyDifferent />
      </>
    )
  }
  if (!outcome) return null
  return (
    <PanelSection title="EVA budget">
      <p className="text-sm text-muted-foreground">No safe walking route to this stop with a {limit}° limit, so there is no budget to show.</p>
    </PanelSection>
  )
}
