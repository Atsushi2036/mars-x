import { CircleAlert, CircleCheck, CircleMinus, CircleX } from '@/ui/icons'
import { useEffect, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RunLoadResult } from '@/intelligence'
import { useApp } from '@/store/app'
import { cn } from '@/lib/utils'
import { HonestyChip, StatCard } from '@/ui/kit'
import { ProvenanceChip } from '../shared/ProvenanceChip'
import { fmtCi, fmtNum, fmtPct, NO_DATA, short } from '../shared/fmt'
import { BASELINES, baselineRow, type BaselineRow } from './baselines'
import { DISCLAIMER, failureLabel, NOT_COVERED, PROGRAM, STAMP, statusLabel, THRESHOLDS_VERSION, VIOLATION_LABEL, verificationLabel, type LevelRow, type Scorecard, type Status } from './scorecard'
import { useBaselines } from './verification'
import { useReplay } from './store'

const STATUS_STYLE: Record<Status, { icon: typeof CircleCheck; cls: string }> = {
  pass: { icon: CircleCheck, cls: 'text-success' },
  fail: { icon: CircleX, cls: 'text-destructive' },
  unverifiable: { icon: CircleAlert, cls: 'text-destructive' },
  'not-run': { icon: CircleMinus, cls: 'text-muted-foreground' },
}

export function StatusMark({ status }: { status: Status }) {
  const s = STATUS_STYLE[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', s.cls)}>
      <s.icon className="size-4" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

function Block({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-base font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** "84.0%" with its interval on a second line, so the column stays narrow on phones. */
function CiCell({ p, ci }: { p: number | null; ci: readonly [number, number] | null }) {
  if (p === null || !ci) return <>{NO_DATA}</>
  return (
    <>
      {fmtPct(p)}
      <span className="block text-sm text-muted-foreground">
        {fmtPct(ci[0])} to {fmtPct(ci[1])}
      </span>
    </>
  )
}

function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn('min-w-0 text-right [overflow-wrap:anywhere]', mono && 'font-mono tabular-nums')}>{v}</dd>
    </div>
  )
}

/** Phones: one card per level (a 7-column table does not fit in 390 px). */
function LevelCards({ levels, runLevel }: { levels: LevelRow[]; runLevel: string }) {
  return (
    <ul className="space-y-2 sm:hidden" aria-label="Results per level">
      <li className="rounded-xl border border-border px-3 py-2 text-sm">
        <p className="font-medium">Pre-check</p>
        <p className="text-muted-foreground">Integration check. Not a level. Shown above.</p>
      </li>
      {levels.map((l) => {
        const none = l.status === 'not-run'
        const cells: Array<[string, ReactNode]> = [
          ['Episodes', none ? NO_DATA : l.n],
          ['Success (95% CI)', none ? NO_DATA : <CiCell p={l.success} ci={l.ci} />],
          ['SPL', none ? NO_DATA : fmtNum(l.spl, 3)],
          ['Energy vs oracle', none || l.energyRatio === null ? NO_DATA : `${fmtNum(l.energyRatio, 2)}×`],
          ['Critical violations', none ? NO_DATA : l.violations],
        ]
        return (
          <li key={l.level} className={cn('rounded-xl border border-border px-3 py-2.5 text-sm', l.level === runLevel && 'border-primary/40 bg-primary/5')}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">
                {l.level} <span className="font-normal text-muted-foreground">{l.name}</span>
              </p>
              <StatusMark status={l.status} />
            </div>
            {!none && (
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {cells.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function LevelTable({ levels, runLevel }: { levels: LevelRow[]; runLevel: string }) {
  return (
    <>
      <LevelCards levels={levels} runLevel={runLevel} />
      <LevelTableWide levels={levels} runLevel={runLevel} />
    </>
  )
}

function LevelTableWide({ levels, runLevel }: { levels: LevelRow[]; runLevel: string }) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-border sm:block">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">Results per level</caption>
        <thead className="bg-surface text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Level
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Verdict
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Episodes
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Success (95% CI)
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              SPL
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Energy vs oracle
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Critical violations
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr>
            <th scope="row" className="px-3 py-2 text-left font-medium">
              Pre-check <span className="block font-normal text-muted-foreground">Integration check</span>
            </th>
            <td colSpan={6} className="px-3 py-2 text-muted-foreground">
              Not a level. Shown above.
            </td>
          </tr>
          {levels.map((l) => (
            <tr key={l.level} className={cn(l.level === runLevel && 'bg-primary/5')}>
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {l.level}
                <span className="block font-normal text-muted-foreground">{l.name}</span>
              </th>
              <td className="px-3 py-2">
                <StatusMark status={l.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : l.n}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : <CiCell p={l.success} ci={l.ci} />}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : fmtNum(l.spl, 3)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : l.energyRatio === null ? NO_DATA : `${fmtNum(l.energyRatio, 2)}×`}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : l.violations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BaselineBlock({ lvl, suite }: { lvl: LevelRow; suite: string }) {
  const base = useApp((s) => s.dataset?.base ?? null)
  const load = useBaselines((s) => s.load)
  const ensure = useBaselines((s) => s.ensure)
  useEffect(() => {
    if (base) ensure(base)
  }, [base, ensure])
  const rows: BaselineRow[] =
    load?.status === 'ready' ? BASELINES.flatMap((b) => (load.cards[b.id] ? [baselineRow(b, load.cards[b.id]!, lvl.level)].filter((x): x is BaselineRow => x !== null) : [])) : []
  const differs = rows.some((r) => r.suite !== suite)
  return (
    <Block title={`Compared with the baselines (${lvl.level})`} id="sc-base">
      {!load ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the baselines…
        </p>
      ) : load.status === 'unavailable' ? (
        <p className="text-sm text-muted-foreground">Baselines not available. {load.reason}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-0 sm:min-w-[26rem] text-sm">
              <caption className="sr-only">Your run against the verified baselines on the same level</caption>
              <thead className="bg-surface text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Agent
                  </th>
                  <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                    Episodes
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Success (95% CI)
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    SPL
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Violations
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr className="bg-primary/5">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    Your run
                  </th>
                  <td className="hidden px-3 py-2 text-right font-mono tabular-nums sm:table-cell">{lvl.n}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums"><CiCell p={lvl.success} ci={lvl.ci} /></td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(lvl.spl, 3)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{lvl.violations}</td>
                </tr>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {b.label}
                      <span className="hidden font-normal text-muted-foreground sm:block">{b.note}</span>
                    </th>
                    <td className="hidden px-3 py-2 text-right font-mono tabular-nums sm:table-cell">{b.n}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums"><CiCell p={b.success} ci={b.ci} /></td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(b.spl, 3)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{b.violations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            Baselines are scored on the whole {rows[0]?.suite ?? 'suite'} test split with full re-simulation (`marsx bench scorecard`).
            {differs ? ' Your run used a different suite version, so the comparison is indicative only.' : ''}
            {rows.length < BASELINES.length ? ' Some baselines are missing from this dataset.' : ''}
          </p>
        </>
      )}
    </Block>
  )
}

export function ScorecardDialog({ result, card, open, onOpenChange, onReplayFailure }: { result: RunLoadResult; card: Scorecard; open: boolean; onOpenChange: (o: boolean) => void; onReplayFailure: (outcome: string) => void }) {
  const r = result.run
  const lvl = card.levels.find((l) => l.level === card.runLevel)!
  const total = r.episodes.length
  const select = useReplay((s) => s.select)
  void select
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="space-y-1 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-xl">Scorecard</DialogTitle>
          <DialogDescription>
            {PROGRAM}. Preview computed in your browser from the episodes in the file; the official scorecard comes from <span className="font-mono">marsx bench scorecard</span>.
          </DialogDescription>
          <HonestyChip />
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <Block title="Run" id="sc-run">
            <dl className="rounded-xl border border-border px-3">
              <KV k="Model" v={r.policy.name} mono={false} />
              <KV k="Model sha256" v={r.policy.sha256 ? <span title={r.policy.sha256}>{short(r.policy.sha256, 16)}</span> : NO_DATA} />
              <KV k="Via" v={r.policy.kind === 'onnx' ? 'ONNX policy' : r.policy.kind === 'python' ? 'Python SDK' : 'Baseline'} mono={false} />
              <KV k="Suite" v={`${r.suite.id} ${r.suite.version} · ${r.suite.level} · ${r.suite.split}`} />
              <KV k="MARS-X" v={`${r.producer.marsxVersion}${r.producer.gitSha ? ` · ${short(r.producer.gitSha, 8)}` : ''}`} />
              <KV k="Date" v={r.createdUtc} />
              <KV
                k="Check"
                v={
                  <span className={cn('inline-flex items-start justify-end gap-1.5 text-right', card.verified ? 'text-success' : 'text-destructive')}>
                    {card.verified ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                    {verificationLabel(card.verification, card.resimPending)}
                  </span>
                }
                mono={false}
              />
            </dl>
          </Block>

          <Block title="Verdict" id="sc-verdict">
            {!card.precheck.passed && (
              <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="font-medium">Integration check failed. No level is granted.</p>
                <ul className="mt-1 list-disc pl-4">
                  {card.precheck.reasons.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <StatCard compact label="Success" value={lvl.success === null ? '—' : (lvl.success * 100).toFixed(0)} unit={lvl.success === null ? undefined : '%'} provenance="modeled" />
              <StatCard compact label="Episodes" value={lvl.n} provenance="modeled" />
              <StatCard compact label="Violations" value={lvl.violations ?? 0} provenance="modeled" />
            </div>
            <LevelTable levels={card.levels} runLevel={card.runLevel} />
            {lvl.reasons.length > 0 && lvl.status !== 'pass' && (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {lvl.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted-foreground">
              Thresholds {THRESHOLDS_VERSION}: L1 at least 80% success; L2 at least 70%; L3 a Wilson 95% lower bound of at least 60% with 20 or more episodes in every family. Any critical violation fails the level. SPL is measured against the A* oracle path.
            </p>
            <p className={cn('rounded-xl border px-3 py-2 text-sm', card.seal ? 'border-primary/40 bg-primary/5' : 'border-border bg-surface')}>
              {card.seal ?? `No level granted. ${STAMP}.`}
            </p>
          </Block>

          <Block title="Critical violations" id="sc-viol">
            <ul className="divide-y divide-border rounded-xl border border-border">
              {Object.entries(VIOLATION_LABEL)
                .filter(([k]) => k !== 'hazard' || (lvl.violationTypes.hazard ?? 0) > 0)
                .map(([k, label]) => (
                  <li key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span>{label}</span>
                    <span className={cn('font-mono tabular-nums', (lvl.violationTypes[k] ?? 0) > 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {lvl.violationTypes[k] ?? 0} {(lvl.violationTypes[k] ?? 0) === 1 ? 'episode' : 'episodes'}
                    </span>
                  </li>
                ))}
            </ul>
            <p className="text-sm text-muted-foreground">Any one of these fails the level, however high the success rate.</p>
          </Block>

          <BaselineBlock lvl={lvl} suite={`${r.suite.id} ${r.suite.version}`} />

          <Block title="Failures" id="sc-fail">
            {Object.keys(card.failureTaxonomy).length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed episodes in this run.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {Object.entries(card.failureTaxonomy).map(([k, n]) => (
                  <li key={k} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1">{failureLabel(k)}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {n} · {fmtPct(n / total)}
                    </span>
                    <button type="button" onClick={() => onReplayFailure(k)} className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                      Replay the first
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {lvl.families.length > 0 && (
            <Block title="By scenario family" id="sc-fam">
              <ul className="divide-y divide-border rounded-xl border border-border">
                {lvl.families.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
                    <span className="font-mono">{f.id}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      n={f.n} · {fmtCi(f.success, f.ci)}
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <Block title="Conditions used" id="sc-cond">
            <dl className="rounded-xl border border-border px-3">
              <KV k="MEDA sols" v={r.conditions.medaSols.length ? <span className="inline-flex items-center gap-2">{r.conditions.medaSols.join(', ')}<ProvenanceChip kind="measured" /></span> : NO_DATA} />
              <KV k="Dust opacity (tau)" v={r.conditions.tau != null ? <span className="inline-flex items-center gap-2">{fmtNum(r.conditions.tau, 2)}<ProvenanceChip kind="assumption" /></span> : NO_DATA} />
              <KV k="Gravity" v={<span className="inline-flex items-center gap-2">{fmtNum(r.conditions.gravity, 3)} m/s²<ProvenanceChip kind="derived" /></span>} />
              <KV k="One-way light time" v={r.conditions.owltMin != null ? <span className="inline-flex items-center gap-2">{fmtNum(r.conditions.owltMin, 1)} min<ProvenanceChip kind="modeled" /></span> : NO_DATA} />
            </dl>
            <p className="text-sm text-muted-foreground">Energy, dust and slip are simplified models. The file does not record where tau came from, so it is shown as an assumption.</p>
          </Block>

          <Block title="Reproducibility" id="sc-repro">
            <dl className="rounded-xl border border-border px-3">
              <KV k="Root seed" v={r.suite.rootSeed} />
              <KV k="Dataset" v={`${r.dataset.id} · ${short(r.dataset.sha256, 16)}`} />
              <KV k="Scenario" v={`${r.scenario.id} · ${short(r.scenario.sha256, 16)}`} />
              <KV k="Run id" v={r.runId} />
              <KV k="Reproduce" v={<span className="break-all">marsx bench scorecard run.json</span>} />
            </dl>
          </Block>

          <Block title="What this test does NOT cover" id="sc-limits">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {NOT_COVERED.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Block>

          <div className="space-y-1 border-t border-border pt-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{STAMP}.</p>
            <p>{DISCLAIMER}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
