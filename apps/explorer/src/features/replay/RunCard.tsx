import { useEffect, useMemo } from 'react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { CircleAlert, CircleCheck, Download, FileText, X } from '@/ui/icons'
import { Details, HonestyChip, Metric, StatCard } from '@/ui/kit'
import { useByo } from '../shared/byo-store'
import { fmtNum, short } from '../shared/fmt'
import { EpisodeList, orderEpisodes, Player } from './Player'
import { buildScorecard, DISCLAIMER, reportJson, verificationLabel } from './scorecard'
import { ScorecardDialog, StatusMark } from './ScorecardDialog'
import { useScorecardUi } from './scorecard-ui'
import { useReplay } from './store'
import { useVerification } from './verification'

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
  const session = useByo((s) => s.run.session)
  const open = useScorecardUi((s) => s.open)
  const setOpen = useScorecardUi((s) => s.setOpen)
  const ver = useVerification()

  const datasetMatches = result && ds ? ds.manifest.contentHash === result.run.dataset.sha256 : null
  const { start, reset } = useVerification.getState()
  useEffect(() => {
    if (session && ds && datasetMatches !== false) start(session, ds)
    else if (!session) reset()
  }, [session, ds, datasetMatches, start, reset])
  const running = ver.status === 'running'
  const card = useMemo(() => (result ? buildScorecard(result, datasetMatches, ver.summary, running) : null), [result, datasetMatches, ver.summary, running])
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

  const pct = lvl.success === null ? null : lvl.success * 100
  const ci = lvl.ci ? `95% CI ${(lvl.ci[0] * 100).toFixed(0)} to ${(lvl.ci[1] * 100).toFixed(0)}` : undefined
  const verified = card.precheck.passed && card.verification?.notResimulable === 0

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-2xl border border-border p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-medium">{fileName ?? 'run.json'}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.policy.name} · {r.suite.level} · {r.suite.id} {r.suite.version}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Remove the run" className="-mr-1 size-10" onClick={closeRun}>
            <X className="size-5" />
          </Button>
        </div>

        <div role={card.precheck.passed ? undefined : 'alert'} className={verified ? 'space-y-1.5 text-sm text-success' : card.precheck.passed && !running ? 'space-y-1.5 text-sm text-foreground' : card.precheck.passed ? 'space-y-1.5 text-sm text-muted-foreground' : 'space-y-1.5 text-sm text-destructive'}>
          <p className="flex items-start gap-2">
            {card.precheck.passed ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>{card.precheck.passed || running ? verificationLabel(card.verification, running) : 'Not verifiable. ' + (card.precheck.reasons[0] ?? '')}</span>
          </p>
          {running && <Progress value={Math.round(ver.progress * 100)} aria-label="Re-simulation progress" className="h-1" />}
          {ver.status === 'error' && <p className="text-destructive">Re-simulation could not run: {ver.error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            {r.suite.level} · {lvl.name}
          </span>
          <StatusMark status={lvl.status} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Success" value={pct === null ? '—' : pct.toFixed(0)} unit={pct === null ? undefined : '%'} sub={ci} provenance="modeled" />
          <StatCard label="Episodes" value={lvl.n} sub={`${lvl.violations ?? 0} critical violations`} provenance="modeled" />
        </div>
        <Details summary="More numbers">
          <dl className="divide-y divide-border">
            <Metric label="SPL" value={fmtNum(lvl.spl, 3)} />
            <Metric label="Energy vs oracle" value={lvl.energyRatio === null ? 'No data' : `${fmtNum(lvl.energyRatio, 2)}×`} />
            <Metric label="Dataset" value={datasetMatches === null ? short(r.dataset.sha256, 8) : datasetMatches ? 'matches' : 'different'} mono />
          </dl>
        </Details>

        <div className="flex gap-2">
          <Button className="h-11 flex-1 gap-2" onClick={() => setOpen(true)}>
            <FileText className="size-5" /> Open scorecard
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={() => download(`marsx-scorecard-${r.suite.level}-${r.runId.slice(0, 8)}.json`, JSON.stringify(reportJson(result, card, { generatedUtc: new Date().toISOString(), datasetSha256: ds?.manifest.contentHash ?? null }), null, 2))}
          >
            <Download className="size-5" /> JSON
          </Button>
        </div>
        <HonestyChip />
        <p className="text-xs text-muted-foreground">
          {DISCLAIMER}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Replay an episode on the terrain. Failures come first.</p>
        <EpisodeList episodes={r.episodes} />
        <Player episodes={r.episodes} />
      </div>

      <ScorecardDialog result={result} card={card} open={open} onOpenChange={setOpen} onReplayFailure={replayFailure} />
    </div>
  )
}
