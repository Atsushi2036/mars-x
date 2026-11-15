import { Check, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { compareRoutes, marswalkReport, type WalkReport } from '@/core/mission/marswalk'
import { worldToCell } from '@/core/mission/geometry'
import { ProvenanceChip } from '@/features/shared/ProvenanceChip'
import type { Provenance } from '@/features/shared/provenance'
import { ENERGY } from '@/intelligence/sim/energy'
import { PROFILES } from '@/intelligence/nav/profiles'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { selectScienceTarget, useMission } from '@/store/mission'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Section } from './Section'

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
    <div className="space-y-0.5 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="flex items-center gap-1.5">
          <span className="font-mono text-sm tabular-nums text-foreground">{value}</span>
          <ProvenanceChip kind={chip} />
        </dd>
      </div>
      {note && <p className="text-[11px] leading-4 text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Small segmented choice (no native select). */
function Choice({ label, value, options, unit, onChange }: { label: string; value: number; options: number[]; unit: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span id={`choice-${label}`} className="text-muted-foreground">
        {label} ({unit === '°' ? 'degrees' : 'minutes'})
      </span>
      <ToggleGroup type="single" value={String(value)} onValueChange={(v) => v && onChange(Number(v))} variant="outline" spacing={0} aria-labelledby={`choice-${label}`}>
        {options.map((o) => (
          <ToggleGroupItem key={o} value={String(o)} className="h-9 min-w-10 px-2 font-mono text-xs tabular-nums">
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
        'flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium',
        ok ? 'border-chart-3/40 bg-chart-3/10 text-foreground' : 'border-destructive/50 bg-destructive/10 text-foreground',
      )}
    >
      <Icon className={cn('size-4 shrink-0', ok ? 'text-chart-3' : 'text-destructive')} aria-hidden="true" />
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
    <Section title="Science stop" hint="Pick where the crew walks to. You can also click a diamond on the map.">
      {status === 'loading' && <p className="text-xs text-muted-foreground">Loading targets</p>}
      {status === 'ready' && targets.length === 0 && <p className="text-xs text-muted-foreground">No waypoints in this dataset.</p>}
      {sorted.length > 0 && (
        <ul ref={list} className="relative max-h-52 divide-y divide-border overflow-y-auto overscroll-contain rounded-lg border border-border" aria-label="Science stops, nearest first">
          {sorted.map((t) => {
            const on = t.id === picked
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => void selectScienceTarget(t.id)}
                  className={cn(
                    'flex min-h-11 w-full flex-col justify-center px-3 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    on ? 'bg-primary/10' : 'hover:bg-muted',
                  )}
                >
                  <span className="font-medium text-foreground">{t.label}</span>
                  <span className="text-muted-foreground">{t.detail}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {selected?.waypoint && (
        <dl className="rounded-lg border border-border px-3 py-1 divide-y divide-border">
          <Line label="Sol of the visit" value={String(selected.waypoint.sol)} chip="measured" note="Perseverance position recorded at this sol." />
          <Line label="Measured tilt" value={`${minus(selected.waypoint.tiltDeg.toFixed(1))}°`} chip="measured" note="Tilt of the rover body at this waypoint (MMGIS)." />
        </dl>
      )}
      {selected?.kind === 'mineral' && (
        <p className="text-[11px] leading-4 text-muted-foreground">CRISM mineral map: a machine-learning product, so treat the patch as a candidate, not a confirmed outcrop.</p>
      )}
    </Section>
  )
}

function EvaBudget({ r }: { r: WalkReport }) {
  const walk = useMission((s) => s.walk)
  const setWalk = useMission((s) => s.setWalk)
  return (
    <Section title="EVA budget" hint="Round trip on the same route, from the shelter (the start) to the stop and back.">
      <Verdict ok={r.withinBudget}>
        {r.withinBudget
          ? `Fits the ${walk.evaHours} h EVA with ${fmtDuration(r.marginS)} to spare`
          : r.marginS < 0
            ? `Over the ${walk.evaHours} h EVA by ${fmtDuration(-r.marginS)}`
            : 'Not enough consumables for the round trip'}
      </Verdict>
      <dl className="divide-y divide-border">
        <Line label="Route, one way" value={`${f0(r.distanceM)} m`} chip="derived" note="Planned on the 2 m grid over the real DEM." />
        <Line label="Walking speed" value={`${walk.speedMs} m/s`} chip="assumption" note="Suited walking speed; no measured value for Mars." />
        <Line label="Walk out and back" value={fmtDuration(r.outboundS + r.returnS)} chip="derived" />
        <Line label="Time at the stop" value={`${walk.stopMin} min`} chip="assumption" />
        <Line label="Round trip" value={fmtDuration(r.roundTripS)} chip="derived" />
        <Line label="EVA duration" value={`${walk.evaHours} h`} chip="assumption" note="Typical planning length; adjustable in the SDK." />
        <Line label="Return margin" value={`${minus(fmtDuration(r.marginS))} (${minus(r.marginPct.toFixed(0))}%)`} chip="derived" note="EVA time left after being back at the shelter." />
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
      <Choice label="Time at the stop" value={walk.stopMin} options={[15, 30, 60, 90]} unit="min" onChange={(v) => setWalk({ stopMin: v })} />
    </Section>
  )
}

function ShelterRule({ r }: { r: WalkReport }) {
  const walk = useMission((s) => s.walk)
  const setWalk = useMission((s) => s.setWalk)
  const s = r.shelter
  return (
    <Section title="Shelter rule" hint="If a solar particle alert sounds, the crew must be back at the shelter inside the window. Training rule, not a forecast.">
      <Verdict ok={s.unsafeFromM === null}>
        {s.unsafeFromM === null
          ? `All of the route is within ${walk.shelterMin} min of the shelter`
          : `${f0(s.unsafeM)} m of the route are more than ${walk.shelterMin} min from the shelter`}
      </Verdict>
      <dl className="divide-y divide-border">
        <Line label="Shelter window" value={`${walk.shelterMin} min`} chip="assumption" />
        <Line label="Farthest safe distance" value={`${f0(s.maxSafeM)} m`} chip="derived" note={`${walk.shelterMin} min at ${walk.speedMs} m/s along the route back.`} />
        <Line label="Beyond the window" value={`${f0(s.unsafeM)} m`} chip="derived" note={s.unsafeFromM === null ? 'Nothing is flagged on the map.' : 'Drawn in red on the map, with a marker where the window runs out.'} />
      </dl>
      <Choice label="Shelter window" value={walk.shelterMin} options={[10, 15, 30, 45, 60]} unit="min" onChange={(v) => setWalk({ shelterMin: v })} />
    </Section>
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
    <Section title="Why this differs from the rover route">
      <ul className="list-disc space-y-1.5 pl-4 text-xs leading-5 text-muted-foreground">
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
    </Section>
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
      <Section title="Astronaut limits" hint="What makes this a walk and not a drive.">
        <dl className="divide-y divide-border">
          <Line label="Slope limit" value={`${limit}°`} chip="assumption" note="Conservative planning value for a suited crew; lunar studies cite 15 to 20°." />
          <Line label="Walking speed" value={`${walk.speedMs} m/s`} chip="assumption" />
        </dl>
        <Choice label="Slope limit" value={limit} options={[10, 15, 20]} unit="°" onChange={setLimit} />
      </Section>
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
    <Section title="EVA budget">
      <p className="text-xs text-muted-foreground">No safe walking route to this stop with a {limit}° limit, so there is no budget to show.</p>
    </Section>
  )
}
