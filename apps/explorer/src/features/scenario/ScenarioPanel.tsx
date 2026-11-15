import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Route } from '@/ui/icons'
import { Chip, Details, Learn, PanelSection, StatCard, type ChipTone } from '@/ui/kit'
import { ExploreTools } from '@/ui/panels/ExplorePanel'
import { DayPlayer } from '@/ui/panels/SunSection'
import { ProvenanceChip } from '../shared/ProvenanceChip'
import { NO_DATA, fmtClock, fmtNum, kelvinToC } from '../shared/fmt'
import { buildConditionRows, tableTimeMs, type ConditionRow, type LinkReading, type MedaSummary, type SunReading } from './conditions'
import { loadMeda, loadOwltTable, loadSunTable } from './data'
import { COMM_LABEL, MEDA_SOLS, SCENARIOS, scenarioById, scenarioLabel, type CommMode, type Level } from './scenarios'
import { useScenario } from './store'

const LEVEL_TONE: Record<Level, ChipTone> = { L1: 'primary', L2: 'warning', L3: 'danger' }

function ScenarioPicker() {
  const id = useScenario((s) => s.scenarioId)
  const select = useScenario((s) => s.selectScenario)
  return (
    <div role="radiogroup" aria-label="Scenario" className="space-y-1.5">
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
              'flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'border-primary bg-primary/10' : 'border-border bg-transparent hover:bg-muted',
            )}
          >
            <Chip tone={LEVEL_TONE[s.level]} className="h-6 w-9 justify-center px-0">
              {s.level}
            </Chip>
            <span className="min-w-0 flex-1 truncate">{scenarioLabel(s)}</span>
          </button>
        )
      })}
    </div>
  )
}

function ConditionList({ rows }: { rows: ConditionRow[] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.key} className="py-2">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-sm text-muted-foreground">{r.label}</dt>
            {r.provenance && <ProvenanceChip kind={r.provenance} />}
          </div>
          <dd className={cn('text-sm tabular-nums', r.provenance ? 'text-foreground' : 'text-muted-foreground')}>{r.value}</dd>
          <p className="text-xs text-muted-foreground">{r.note}</p>
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

  // the sun and the haze of the 3D scene are driven by scene/ConditionsDriver from the same scenario store

  const rows = useMemo(
    () => buildConditionRows({ scenario, sol, lmstH, tauOverride, comm, meda, sun, link }),
    [scenario, sol, lmstH, tauOverride, comm, meda, sun, link],
  )
  return { rows, loading, hasSun: sunTable !== null, scenario, sol, meda }
}

/** Three headline numbers for the chosen sol. Every card keeps its provenance chip; a missing value says "No data". */
function ConditionCards({ rows, meda, loading }: { rows: ConditionRow[]; meda: MedaSummary | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-2" role="status" aria-label="Loading conditions">
        <Skeleton className="h-[92px] rounded-2xl" />
        <Skeleton className="h-[92px] rounded-2xl" />
        <Skeleton className="h-[92px] rounded-2xl" />
      </div>
    )
  }
  const d = meda?.daily
  const temp = rows.find((r) => r.key === 'temperature')
  const press = rows.find((r) => r.key === 'pressure')
  const tau = rows.find((r) => r.key === 'tau')
  const hasT = d && d.temperatureMaxK !== null && d.temperatureMinK !== null
  const hasP = d && d.pressureMaxPa !== null && d.pressureMinPa !== null
  return (
    <div className="grid grid-cols-3 gap-2">
      <StatCard compact label="Temp. high" value={hasT ? fmtNum(kelvinToC(d.temperatureMaxK!), 0) : '—'} unit={hasT ? '°C' : undefined} provenance={temp?.provenance ?? undefined} sub={hasT ? `low ${fmtNum(kelvinToC(d.temperatureMinK!), 0)}°` : NO_DATA} />
      <StatCard compact label="Press. high" value={hasP ? fmtNum(d.pressureMaxPa!, 0) : '—'} unit={hasP ? 'Pa' : undefined} provenance={press?.provenance ?? undefined} sub={hasP ? `low ${fmtNum(d.pressureMinPa!, 0)}` : NO_DATA} />
      <StatCard compact label="Dust haze" value={tau && tau.provenance ? tau.value : '—'} provenance={tau?.provenance ?? undefined} sub={tau?.provenance ? undefined : NO_DATA} />
    </div>
  )
}

export function ScenarioPanel() {
  const ds = useApp((s) => s.dataset)
  const setMode = useApp((s) => s.setMode)
  const { sol, lmstH, tauOverride, comm, setSol, setLmst, setTau, setComm } = useScenario()
  const { rows, loading, hasSun, scenario, meda } = useConditions()
  const tauShown = tauOverride ?? scenario.tau?.value ?? 0.5
  const hasAtmosphere = scenario.sol !== null
  const season = MEDA_SOLS.find((m) => m.sol === sol)?.season

  if (!ds) {
    return (
      <div className="space-y-3 p-4" role="status" aria-label="Loading scenario">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  const more = rows.filter((r) => r.key === 'wind' || r.key === 'sun' || r.key === 'owlt' || r.key === 'uplink')

  return (
    <div>
      <PanelSection
        title="Current conditions"
        action={
          <span className="flex items-center gap-1">
            {sol !== null && <Chip tone={season === 'dust storm' ? 'warning' : 'neutral'}>Sol {sol}{season ? ` · ${season}` : ''}</Chip>}
            <Learn title="Where these come from">
              <p>Temperature and pressure are Perseverance MEDA readings for the chosen sol. The sun comes from the Mars24 model. Haze is a published or assumed value, labelled on each card.</p>
              <p>A missing value stays missing: it says No data, never a placeholder.</p>
            </Learn>
          </span>
        }
      >
        {hasAtmosphere ? <ConditionCards rows={rows} meda={meda} loading={loading} /> : <p className="text-sm text-muted-foreground">Geometry only: no sun or atmosphere in this scenario.</p>}
      </PanelSection>

      <PanelSection title="Time and sky">
        <div className="space-y-4">
          <div className="space-y-2">
            <p id="sol-label" className="text-sm text-muted-foreground">
              Sol
            </p>
            <ToggleGroup
              type="single"
              value={sol === null ? '' : String(sol)}
              onValueChange={(v) => v && setSol(Number(v))}
              variant="outline"
              spacing={1}
              className="flex w-full"
              aria-labelledby="sol-label"
              disabled={!hasAtmosphere}
            >
              {MEDA_SOLS.map((m) => (
                <ToggleGroupItem key={m.sol} value={String(m.sol)} className="h-10 min-w-0 flex-1 px-0 text-sm tabular-nums" title={m.season}>
                  {m.sol}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label id="lmst-label" className="text-sm text-muted-foreground">
                Time of day
              </label>
              <span className="text-sm font-medium tabular-nums">{fmtClock(lmstH)}</span>
            </div>
            <Slider aria-labelledby="lmst-label" min={0} max={24.65} step={0.25} value={[lmstH]} onValueChange={([v]) => v !== undefined && setLmst(v)} disabled={!hasAtmosphere || !hasSun} />
            {hasAtmosphere && !hasSun && !loading && <p className="text-xs text-muted-foreground">No Mars24 sun table for sol {sol}, so the sun cannot move.</p>}
            <DayPlayer />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label id="tau-label" className="text-sm text-muted-foreground">
                Dust haze (τ)
              </label>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">{tauShown.toFixed(2)}</span>
                {tauOverride !== null && (
                  <>
                    <ProvenanceChip kind="assumption" />
                    <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setTau(null)}>
                      Reset
                    </Button>
                  </>
                )}
              </span>
            </div>
            <Slider aria-labelledby="tau-label" min={0} max={3} step={0.05} value={[tauShown]} onValueChange={([v]) => v !== undefined && setTau(v)} disabled={!hasAtmosphere} />
            <p className="text-xs text-muted-foreground">Typical 0.3 to 1. A dust storm is above 2.</p>
          </div>

          <div className="space-y-2">
            <p id="comm-label" className="text-sm text-muted-foreground">
              Communication
            </p>
            <ToggleGroup type="single" value={comm} onValueChange={(v) => v && setComm(v as CommMode)} variant="outline" spacing={0} className="w-full" aria-labelledby="comm-label">
              {(Object.keys(COMM_LABEL) as CommMode[]).map((c) => (
                <ToggleGroupItem key={c} value={c} className="h-10 flex-1 px-1 text-sm">
                  {COMM_LABEL[c]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">An operations rule, not a Deep Space Network model.</p>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Scenario" caption="Same ids as the Python benchmark.">
        <ScenarioPicker />
      </PanelSection>

      {more.length > 0 && (
        <PanelSection>
          <Details summary="More conditions">
            <ConditionList rows={more} />
          </Details>
        </PanelSection>
      )}

      <ExploreTools />

      <div className="sticky bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur max-md:px-3.5">
        <Button className="h-11 w-full gap-2 text-base" onClick={() => setMode('mission')}>
          <Route className="size-5" strokeWidth={1.75} /> Plan a route
        </Button>
      </div>
    </div>
  )
}
