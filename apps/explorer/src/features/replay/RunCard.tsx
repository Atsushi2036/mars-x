import { CircleAlert, CircleCheck, Download, FileText, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { useByo } from '../shared/byo-store'
import { fmtCi, fmtNum, short } from '../shared/fmt'
import { EpisodeList, orderEpisodes, Player } from './Player'
import { buildScorecard, DISCLAIMER, reportJson, STAMP } from './scorecard'
import { ScorecardDialog, StatusMark } from './ScorecardDialog'
import { useReplay } from './store'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Summary of the loaded run.json: verdict, key numbers, scorecard, report download and the episode replay. */
export function RunCard() {
  const result = useByo((s) => s.run.result)
  const fileName = useByo((s) => s.run.fileName)
  const closeRun = useByo((s) => s.actions.closeRun)
  const ds = useApp((s) => s.dataset)
  const select = useReplay((s) => s.select)
  const [open, setOpen] = useState(false)

  const datasetMatches = result && ds ? ds.manifest.contentHash === result.run.dataset.sha256 : null
  const card = useMemo(() => (result ? buildScorecard(result, datasetMatches) : null), [result, datasetMatches])
  if (!result || !card) return null
  const r = result.run
  const lvl = card.levels.find((l) => l.level === card.runLevel)!

  const replayFailure = (outcome: string) => {
    const first = orderEpisodes(r.episodes).find((e) => e.outcome === outcome && e.trajectory)
    if (first) {
      setOpen(false)
      void select(first)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2.5 rounded-lg border border-border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{fileName ?? 'run.json'}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {r.policy.name} · {r.suite.level} · {r.suite.id} {r.suite.version}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Remove the run" className="-mr-1 size-9 md:size-7" onClick={closeRun}>
            <X />
          </Button>
        </div>

        <p className={card.precheck.passed ? 'flex items-center gap-1.5 text-xs text-success' : 'flex items-center gap-1.5 text-xs text-destructive'} role={card.precheck.passed ? undefined : 'alert'}>
          {card.precheck.passed ? <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" /> : <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
          {card.precheck.passed ? 'Metrics recomputed from the episodes match the file.' : 'Not verifiable. ' + card.precheck.reasons[0]}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {r.suite.level} · {lvl.name}
          </span>
          <StatusMark status={lvl.status} />
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Episodes</dt>
            <dd className="font-mono tabular-nums">{lvl.n}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Success (95% CI)</dt>
            <dd className="font-mono tabular-nums">{fmtCi(lvl.success, lvl.ci)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">SPL</dt>
            <dd className="font-mono tabular-nums">{fmtNum(lvl.spl, 3)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Energy vs oracle</dt>
            <dd className="font-mono tabular-nums">{lvl.energyRatio === null ? 'No data' : `${fmtNum(lvl.energyRatio, 2)}×`}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Critical violations</dt>
            <dd className="font-mono tabular-nums">{lvl.violations}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dataset</dt>
            <dd className="font-mono tabular-nums" title={r.dataset.sha256}>
              {datasetMatches === null ? short(r.dataset.sha256, 8) : datasetMatches ? 'matches' : 'different'}
            </dd>
          </div>
        </dl>

        <div className="flex gap-2">
          <Button className="h-10 flex-1 md:h-8" onClick={() => setOpen(true)}>
            <FileText /> Open scorecard
          </Button>
          <Button
            variant="outline"
            className="h-10 md:h-8"
            onClick={() => download(`marsx-scorecard-${r.suite.level}-${r.runId.slice(0, 8)}.json`, JSON.stringify(reportJson(result, card, { generatedUtc: new Date().toISOString(), datasetSha256: ds?.manifest.contentHash ?? null }), null, 2))}
          >
            <Download /> JSON
          </Button>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {STAMP}. {DISCLAIMER}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Replay an episode on the terrain. Failures come first.</p>
        <EpisodeList episodes={r.episodes} />
        <Player episodes={r.episodes} />
      </div>

      <ScorecardDialog result={result} card={card} open={open} onOpenChange={setOpen} onReplayFailure={replayFailure} />
    </div>
  )
}
