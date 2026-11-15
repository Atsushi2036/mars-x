import { CircleAlert, Pause, Play, RotateCcw } from '@/ui/icons'
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

/** Filter key of an episode: 'ok' for a clean success, otherwise its outcome. */
export const filterKey = (e: Episode) => (e.outcome === 'success' && e.violations === 0 ? 'ok' : e.outcome)

export function filterCounts(eps: readonly Episode[]): [string, number][] {
  const m = new Map<string, number>()
  for (const e of eps) m.set(filterKey(e), (m.get(filterKey(e)) ?? 0) + 1)
  // failures first (alphabetical), then successes
  return [...m.entries()].sort(([a], [b]) => Number(a === 'ok') - Number(b === 'ok') || (a < b ? -1 : 1))
}

export function EpisodeList({ episodes }: { episodes: readonly Episode[] }) {
  const sel = useReplay((s) => s.episodeIndex)
  const select = useReplay((s) => s.select)
  const [all, setAll] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)
  const ordered = useMemo(() => orderEpisodes(episodes), [episodes])
  const counts = useMemo(() => filterCounts(episodes), [episodes])
  const filtered = useMemo(() => (filter ? ordered.filter((e) => filterKey(e) === filter) : ordered), [ordered, filter])
  const shown = all ? filtered : filtered.slice(0, 12)
  if (episodes.length === 0) return <p className="text-sm text-muted-foreground">This run has no episodes.</p>
  return (
    <div className="space-y-1.5">
      {counts.length > 1 && (
        <div role="group" aria-label="Filter episodes by result" className="flex flex-wrap gap-1">
          {[['', episodes.length] as [string, number], ...counts].map(([k, n]) => {
            const on = (filter ?? '') === k
            return (
              <button
                key={k || 'all'}
                type="button"
                aria-pressed={on}
                onClick={() => (setFilter(k || null), setAll(false))}
                className={cn(
                  'inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'border-primary/60 bg-primary/10 font-medium text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {k === '' ? 'All' : k === 'ok' ? 'Reached the goal' : failureLabel(k)}
                <span className="font-mono tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>
      )}
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
                  'flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
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
      {filtered.length > 12 && (
        <Button variant="ghost" size="sm" className="h-8 w-full text-sm" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${filtered.length} episodes`}
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
    <div className="space-y-2.5 rounded-2xl border border-border p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Episode #{ep.index}
          <span className={cn('ml-2 text-sm font-normal', failed ? 'text-destructive' : 'text-success')}>{failed ? failureLabel(ep.outcome) : 'Reached the goal'}</span>
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" className="size-11" aria-label={playing ? 'Pause replay' : 'Play replay'} onClick={() => (step >= last ? (setStep(0), setPlaying(true)) : setPlaying(!playing))}>
          {step >= last && !playing ? <RotateCcw /> : playing ? <Pause /> : <Play />}
        </Button>
        <div className="min-w-0 flex-1 space-y-1">
          <Slider aria-label="Replay position" min={0} max={last} step={1} value={[i]} onValueChange={([v]) => v !== undefined && (setPlaying(false), setStep(v))} />
          <p className="flex justify-between font-mono text-sm tabular-nums text-muted-foreground">
            <span>{fmtElapsed(tS)}</span>
            <span>
              step {i}/{last}
            </span>
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
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
        <Button variant="outline" size="sm" className="h-11 w-full text-sm" onClick={() => (setPlaying(false), setStep(last))}>
          Jump to the moment it failed
        </Button>
      )}
      {events.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Events</p>
          <ul className="max-h-36 space-y-0.5 overflow-y-auto">
            {events.slice(0, 40).map((e, k) => (
              <li key={`${e.t}-${k}`}>
                <button type="button" className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={() => (setPlaying(false), setStep(e.step))}>
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
