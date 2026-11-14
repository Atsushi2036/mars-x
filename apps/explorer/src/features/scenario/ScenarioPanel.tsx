import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { setHaze, setSun, useApp } from '@/store/app'
import { Section } from '@/ui/panels/Section'
import { ProvenanceChip } from '../shared/ProvenanceChip'
import { fmtClock } from '../shared/fmt'
import { buildConditionRows, tableTimeMs, type ConditionRow, type LinkReading, type MedaSummary, type SunReading } from './conditions'
import { loadMeda, loadOwltTable, loadSunTable } from './data'
import { COMM_LABEL, MEDA_SOLS, SCENARIOS, scenarioById, type CommMode } from './scenarios'
import { useScenario } from './store'

function ScenarioPicker() {
  const id = useScenario((s) => s.scenarioId)
  const select = useScenario((s) => s.selectScenario)
  return (
    <div role="radiogroup" aria-label="Scenario" className="space-y-1">
      {SCENARIOS.map((s) => {
        const on = s.id === id
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => select(s.id)}
            className={cn(
              'flex min-h-10 w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:min-h-9',
              on ? 'border-primary/60 bg-primary/10' : 'border-border bg-transparent hover:bg-muted',
            )}
          >
            <span className={cn('w-6 shrink-0 font-mono text-[11px] font-semibold tabular-nums', on ? 'text-primary' : 'text-muted-foreground')}>{s.level}</span>
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
          </button>
        )
      })}
    </div>
  )
}

function Rows({ rows }: { rows: ConditionRow[] }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r) => (
        <div key={r.key} className="space-y-0.5 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-xs text-muted-foreground">{r.label}</dt>
            {r.provenance && <ProvenanceChip kind={r.provenance} />}
          </div>
          <dd className={cn('font-mono text-sm tabular-nums', r.provenance ? 'text-foreground' : 'text-muted-foreground')}>{r.value}</dd>
          <p className="text-[11px] leading-4 text-muted-foreground">{r.note}</p>
        </div>
      ))}
    </dl>
  )
}

/** Fetches the optional condition tables for the chosen scenario and exposes the resolved readings. */
function useConditions() {
  const ds = useApp((s) => s.dataset)
  const { scenarioId, sol, lmstH, tauOverride, comm } = useScenario()
  const scenario = scenarioById(scenarioId)
  const [meda, setMeda] = useState<MedaSummary | null>(null)
  const [sunTab, setSunTab] = useState<{ table: Awaited<ReturnType<typeof loadSunTable>>; sol: number | null } | null>(null)
  const [owlt, setOwlt] = useState<Awaited<ReturnType<typeof loadOwltTable>>>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ds) return
    let live = true
    setLoading(true)
    Promise.all([
      sol === null ? null : loadMeda(ds, sol),
      sol === null ? null : loadSunTable(ds, sol),
      sol === null ? null : loadOwltTable(ds),
    ])
      .then(([m, s, o]) => {
        if (!live) return
        setMeda(m)
        setSunTab({ table: s, sol })
        setOwlt(o)
      })
      .catch(() => {
        if (live) {
          setMeda(null)
          setSunTab({ table: null, sol })
          setOwlt(null)
        }
      })
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [ds, sol])

  const sunTable = sunTab && sunTab.sol === sol ? sunTab.table : null
  const { sun, link } = useMemo(() => {
    let sunR: SunReading | null = null
    let linkR: LinkReading | null = null
    if (sunTable) {
      try {
        const st = sunTable.table.at(tableTimeMs(sunTable.startMs, lmstH))
        sunR = { azimuthDeg: st.azimuthDeg, elevationDeg: st.elevationDeg }
        if (owlt) {
          const l = owlt.at(tableTimeMs(sunTable.startMs, lmstH))
          linkR = { owltS: l.owltS, linkAvailable: l.linkAvailable }
        }
      } catch {
        /* time outside the table: No data */
      }
    }
    return { sun: sunR, link: linkR }
  }, [sunTable, owlt, lmstH])

  // the 3D scene follows the conditions: sun direction and haze
  useEffect(() => {
    if (sun) setSun(sun.azimuthDeg, sun.elevationDeg)
  }, [sun])
  const tauNow = tauOverride ?? meda?.tau ?? scenario.tau?.value ?? null
  useEffect(() => {
    if (tauNow !== null) setHaze(tauNow)
  }, [tauNow])

  const rows = useMemo(
    () => buildConditionRows({ scenario, sol, lmstH, tauOverride, comm, meda, sun, link }),
    [scenario, sol, lmstH, tauOverride, comm, meda, sun, link],
  )
  return { rows, loading, hasSun: sunTable !== null, scenario, sol }
}

export function ScenarioPanel() {
  const ds = useApp((s) => s.dataset)
  const { scenarioId, sol, lmstH, tauOverride, comm, setSol, setLmst, setTau, setComm } = useScenario()
  const { rows, loading, hasSun, scenario } = useConditions()
  const tauShown = tauOverride ?? scenario.tau?.value ?? 0.5
  const hasAtmosphere = scenario.sol !== null

  if (!ds) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading scenario">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return (
    <div>
      <Section title="Scenario" hint="The same ids the Python benchmark uses, so a result here matches a result from the SDK.">
        <ScenarioPicker />
        <p className="font-mono text-[11px] text-muted-foreground">{scenarioId}</p>
      </Section>

      <Section title="Time and sky" hint={hasAtmosphere ? undefined : 'This scenario is geometry only: there is no sol, sun or atmosphere to choose.'}>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p id="sol-label" className="text-xs text-muted-foreground">
              Sol (Perseverance MEDA)
            </p>
            <ToggleGroup
              type="single"
              value={sol === null ? '' : String(sol)}
              onValueChange={(v) => v && setSol(Number(v))}
              variant="outline"
              spacing={1}
              className="flex w-full flex-wrap justify-start"
              aria-labelledby="sol-label"
              disabled={!hasAtmosphere}
            >
              {MEDA_SOLS.map((m) => (
                <ToggleGroupItem key={m.sol} value={String(m.sol)} className="h-9 min-w-11 px-2 font-mono text-xs tabular-nums md:h-7" title={m.season}>
                  {m.sol}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {sol !== null && <p className="text-[11px] text-muted-foreground">{MEDA_SOLS.find((m) => m.sol === sol)?.season ?? 'custom'} season</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label id="lmst-label" className="text-xs text-muted-foreground">
                Local mean solar time
              </label>
              <span className="font-mono text-xs tabular-nums">{fmtClock(lmstH)}</span>
            </div>
            <Slider
              aria-labelledby="lmst-label"
              min={0}
              max={24.65}
              step={0.25}
              value={[lmstH]}
              onValueChange={([v]) => v !== undefined && setLmst(v)}
              disabled={!hasAtmosphere || !hasSun}
            />
            {hasAtmosphere && !hasSun && !loading && <p className="text-[11px] text-muted-foreground">Disabled: no Mars24 sun table for sol {sol} in this dataset, so the sun cannot move.</p>}
            {hasAtmosphere && hasSun && <p className="text-[11px] text-muted-foreground">Moves the sun and the shadows. Sun tables are indexed by mean solar time.</p>}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <label id="tau-label" className="text-xs text-muted-foreground">
                Dust opacity (tau)
              </label>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs tabular-nums">{tauShown.toFixed(2)}</span>
                {tauOverride !== null && (
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => setTau(null)}>
                    Reset
                  </Button>
                )}
              </span>
            </div>
            <Slider aria-labelledby="tau-label" min={0} max={3} step={0.05} value={[tauShown]} onValueChange={([v]) => v !== undefined && setTau(v)} disabled={!hasAtmosphere} />
            <p className="text-[11px] text-muted-foreground">Typical 0.3 to 1; a dust storm is above 2. A value you set is labelled assumption.</p>
          </div>

          <div className="space-y-1.5">
            <p id="comm-label" className="text-xs text-muted-foreground">
              Communication mode
            </p>
            <ToggleGroup
              type="single"
              value={comm}
              onValueChange={(v) => v && setComm(v as CommMode)}
              variant="outline"
              spacing={0}
              className="w-full"
              aria-labelledby="comm-label"
            >
              {(Object.keys(COMM_LABEL) as CommMode[]).map((c) => (
                <ToggleGroupItem key={c} value={c} className="h-10 flex-1 px-1 text-xs md:h-8">
                  {COMM_LABEL[c]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-[11px] text-muted-foreground">One plan per sol is an operations constraint, not a simulation of the Deep Space Network.</p>
          </div>
        </div>
      </Section>

      <Section title="Current conditions" hint="Every value says where it comes from. Missing values stay missing.">
        {loading ? (
          <div className="space-y-2" role="status" aria-label="Loading conditions">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <Rows rows={rows} />
        )}
      </Section>
    </div>
  )
}
