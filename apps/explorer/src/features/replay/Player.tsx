import { CircleAlert, Pause, Play, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { halfToFloat, type Episode } from '@/intelligence'
import { cn } from '@/lib/utils'
import { fmtNum } from '../shared/fmt'
import { failureLabel } from './scorecard'
import { EVENT_LABEL, fmtElapsed, stepAtTime, useReplay } from './store'

/** Episodes ordered for review: failures first (grouped by kind), then successes. */
export function orderEpisodes(eps: readonly Episode[]): Episode[] {
  const fail = (e: Episode) => !(e.outcome === 'success' && e.violations === 0)
  return [...eps].sort((a, b) => Number(fail(b)) - Number(fail(a)) || (a.outcome < b.outcome ? -1 : a.outcome > b.outcome ? 1 : 0) || a.index - b.index)
}

export function EpisodeList({ episodes }: { episodes: readonly Episode[] }) {
  const sel = useReplay((s) => s.episodeIndex)
  const select = useReplay((s) => s.select)
  const [all, setAll] = useState(false)
  const ordered = useMemo(() => orderEpisodes(episodes), [episodes])
  const shown = all ? ordered : ordered.slice(0, 12)
  if (episodes.length === 0) return <p className="text-xs text-muted-foreground">This run has no episodes.</p>
  return (
    <div className="space-y-1.5">
      <ul className="space-y-1" aria-label="Episodes">
        {shown.map((e) => {
          const ok = e.outcome === 'success' && e.violations === 0
          const on = sel === e.index
          return (
            <li key={e.index}>
              <button
                type="button"
                aria-pressed={on}
                disabled={!e.trajectory}
                onClick={() => void select(e)}
                className={cn(
                  'flex min-h-10 w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-8',
                  on ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted',
                )}
              >
                <span className="w-9 font-mono tabular-nums text-muted-foreground">#{e.index}</span>
                <span className={cn('min-w-0 flex-1 truncate', !ok && 'font-medium')}>{ok ? 'Reached the goal' : failureLabel(e.outcome)}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{fmtNum(e.pathM, 0)} m</span>
              </button>
            </li>
          )
        })}
      </ul>
      {ordered.length > 12 && (
        <Button variant="ghost" size="sm" className="h-8 w-full text-xs" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${ordered.length} episodes`}
        </Button>
      )}
    </div>
  )
}

export function Player({ episodes }: { episodes: readonly Episode[] }) {
  const { episodeIndex, traj, status, error, step, playing, setStep, setPlaying } = useReplay()
  const ep = useMemo(() => episodes.find((e) => e.index === episodeIndex) ?? null, [episodes, episodeIndex])
  if (episodeIndex === null || !ep) return null
  if (status === 'loading') return <Skeleton className="h-28 w-full" role="status" aria-label="Decoding the trajectory" />
  if (status === 'error' || !traj)
    return (
      <Alert variant="destructive" role="alert">
        <CircleAlert />
        <AlertTitle>This trajectory cannot be replayed</AlertTitle>
        <AlertDescription>{error ?? 'The trajectory is missing.'}</AlertDescription>
      </Alert>
    )
  const last = traj.row.length - 1
  const i = Math.min(last, Math.floor(step))
  const tS = traj.tS[i]!
  const failed = !(ep.outcome === 'success' && ep.violations === 0)
  const soc = halfToFloat(traj.socHalf[i]!)
  const events = ep.events.map((e) => ({ ...e, step: stepAtTime(traj.tS, e.t) }))
  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Episode #{ep.index}
          <span className={cn('ml-2 text-xs font-normal', failed ? 'text-destructive' : 'text-success')}>{failed ? failureLabel(ep.outcome) : 'Reached the goal'}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" className="size-10 md:size-8" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => (step >= last ? (setStep(0), setPlaying(true)) : setPlaying(!playing))}>
          {step >= last && !playing ? <RotateCcw /> : playing ? <Pause /> : <Play />}
        </Button>
        <div className="min-w-0 flex-1 space-y-1">
          <Slider aria-label="Replay position" min={0} max={last} step={1} value={[i]} onValueChange={([v]) => v !== undefined && (setPlaying(false), setStep(v))} />
          <p className="flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
            <span>{fmtElapsed(tS)}</span>
            <span>
              step {i}/{last}
            </span>
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-muted-foreground">Energy</dt>
          <dd className="font-mono tabular-nums">{ep.energyWh != null ? `${Math.round(soc * 100)}%` : 'No data'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Path</dt>
          <dd className="font-mono tabular-nums">{fmtNum(ep.pathM, 0)} m</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Oracle path</dt>
          <dd className="font-mono tabular-nums">{ep.oracle ? `${fmtNum(ep.oracle.pathM, 0)} m` : 'No data'}</dd>
        </div>
      </dl>
      {failed && (
        <Button variant="outline" size="sm" className="h-9 w-full text-xs md:h-8" onClick={() => (setPlaying(false), setStep(last))}>
          Jump to the moment it failed
        </Button>
      )}
      {events.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Events</p>
          <ul className="max-h-28 space-y-0.5 overflow-y-auto">
            {events.slice(0, 40).map((e, k) => (
              <li key={`${e.t}-${k}`}>
                <button type="button" className="flex min-h-8 w-full items-center justify-between gap-2 rounded px-1.5 text-left text-[11px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => (setPlaying(false), setStep(e.step))}>
                  <span>{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{fmtElapsed(e.t)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
