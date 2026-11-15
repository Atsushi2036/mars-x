import { CircleAlert, CircleCheck, CircleMinus, CircleX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RunLoadResult } from '@/intelligence'
import { cn } from '@/lib/utils'
import { ProvenanceChip } from '../shared/ProvenanceChip'
import { fmtCi, fmtNum, fmtPct, NO_DATA, short } from '../shared/fmt'
import { DISCLAIMER, failureLabel, NOT_COVERED, PROGRAM, STAMP, statusLabel, THRESHOLDS_VERSION, type LevelRow, type Scorecard, type Status } from './scorecard'
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
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', s.cls)}>
      <s.icon className="size-3.5" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

function Block({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 text-xs last:border-b-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn('min-w-0 break-all text-right', mono && 'font-mono tabular-nums')}>{v}</dd>
    </div>
  )
}

function LevelTable({ levels, runLevel }: { levels: LevelRow[]; runLevel: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[34rem] text-xs">
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
              <td className="px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : l.n}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : fmtCi(l.success, l.ci)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : fmtNum(l.spl, 3)}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : l.energyRatio === null ? NO_DATA : `${fmtNum(l.energyRatio, 2)}×`}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{l.status === 'not-run' ? NO_DATA : l.violations}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          <DialogTitle className="text-base">Scorecard</DialogTitle>
          <DialogDescription>
            {PROGRAM}. Preview computed in your browser from the episodes in the file; the official scorecard comes from <span className="font-mono">marsx bench scorecard</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <Block title="Run" id="sc-run">
            <dl className="rounded-lg border border-border px-3">
              <KV k="Model" v={r.policy.name} mono={false} />
              <KV k="Model sha256" v={r.policy.sha256 ? <span title={r.policy.sha256}>{short(r.policy.sha256, 16)}</span> : NO_DATA} />
              <KV k="Via" v={r.policy.kind === 'onnx' ? 'ONNX policy' : r.policy.kind === 'python' ? 'Python SDK' : 'Baseline'} mono={false} />
              <KV k="Suite" v={`${r.suite.id} ${r.suite.version} · ${r.suite.level} · ${r.suite.split}`} />
              <KV k="MARS-X" v={`${r.producer.marsxVersion}${r.producer.gitSha ? ` · ${short(r.producer.gitSha, 8)}` : ''}`} />
              <KV k="Date" v={r.createdUtc} />
              <KV
                k="Check"
                v={
                  card.verified ? (
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <CircleCheck className="size-3.5" aria-hidden="true" /> Metrics recomputed from the episodes match
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <CircleAlert className="size-3.5" aria-hidden="true" /> Not verifiable
                    </span>
                  )
                }
                mono={false}
              />
            </dl>
          </Block>

          <Block title="Verdict" id="sc-verdict">
            {!card.precheck.passed && (
              <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <p className="font-medium">Integration check failed. No level is granted.</p>
                <ul className="mt-1 list-disc pl-4">
                  {card.precheck.reasons.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            <LevelTable levels={card.levels} runLevel={card.runLevel} />
            {lvl.reasons.length > 0 && lvl.status !== 'pass' && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {lvl.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              Thresholds {THRESHOLDS_VERSION}: L1 at least 80% success; L2 at least 70%; L3 a Wilson 95% lower bound of at least 60% with 20 or more episodes in every family. Any critical violation fails the level. SPL is measured against the A* oracle path.
            </p>
            <p className={cn('rounded-lg border px-3 py-2 text-xs', card.seal ? 'border-primary/40 bg-primary/5' : 'border-border bg-surface')}>
              {card.seal ?? `No level granted. ${STAMP}.`}
            </p>
          </Block>

          <Block title="Failures" id="sc-fail">
            {Object.keys(card.failureTaxonomy).length === 0 ? (
              <p className="text-xs text-muted-foreground">No failed episodes in this run.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {Object.entries(card.failureTaxonomy).map(([k, n]) => (
                  <li key={k} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="flex-1">{failureLabel(k)}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {n} · {fmtPct(n / total)}
                    </span>
                    <button type="button" onClick={() => onReplayFailure(k)} className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                      Replay the first
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {lvl.families.length > 0 && (
            <Block title="By scenario family" id="sc-fam">
              <ul className="divide-y divide-border rounded-lg border border-border">
                {lvl.families.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-xs">
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
            <dl className="rounded-lg border border-border px-3">
              <KV k="MEDA sols" v={r.conditions.medaSols.length ? <span className="inline-flex items-center gap-2">{r.conditions.medaSols.join(', ')}<ProvenanceChip kind="measured" /></span> : NO_DATA} />
              <KV k="Dust opacity (tau)" v={r.conditions.tau != null ? <span className="inline-flex items-center gap-2">{fmtNum(r.conditions.tau, 2)}<ProvenanceChip kind="assumption" /></span> : NO_DATA} />
              <KV k="Gravity" v={<span className="inline-flex items-center gap-2">{fmtNum(r.conditions.gravity, 3)} m/s²<ProvenanceChip kind="derived" /></span>} />
              <KV k="One-way light time" v={r.conditions.owltMin != null ? <span className="inline-flex items-center gap-2">{fmtNum(r.conditions.owltMin, 1)} min<ProvenanceChip kind="modeled" /></span> : NO_DATA} />
            </dl>
            <p className="text-[11px] text-muted-foreground">Energy, dust and slip are simplified models. The file does not record where tau came from, so it is shown as an assumption.</p>
          </Block>

          <Block title="Reproducibility" id="sc-repro">
            <dl className="rounded-lg border border-border px-3">
              <KV k="Root seed" v={r.suite.rootSeed} />
              <KV k="Dataset" v={`${r.dataset.id} · ${short(r.dataset.sha256, 16)}`} />
              <KV k="Scenario" v={`${r.scenario.id} · ${short(r.scenario.sha256, 16)}`} />
              <KV k="Run id" v={r.runId} />
              <KV k="Reproduce" v={<span className="break-all">marsx bench scorecard run.json</span>} />
            </dl>
          </Block>

          <Block title="What this test does NOT cover" id="sc-limits">
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {NOT_COVERED.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </Block>

          <div className="space-y-1 border-t border-border pt-4 text-[11px] text-muted-foreground">
            <p className="font-medium text-foreground">{STAMP}.</p>
            <p>{DISCLAIMER}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
