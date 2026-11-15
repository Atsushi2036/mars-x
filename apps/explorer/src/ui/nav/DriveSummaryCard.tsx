import { outcomeText, setDriveMode, useDriver } from '@/store/driver'
import { usePlayback } from '@/store/playback'
import { startJourney } from '@/store/watch'
import { CircleAlert, CircleCheck, LoaderCircle } from '@/ui/icons'
import { cn } from '@/lib/utils'

/** While the AI drives: a status line. When it ends: reached or not, distance against A*, steps and outcome, and what to try next. */
export function DriveSummaryCard() {
  const phase = useDriver((s) => s.phase)
  const summary = useDriver((s) => s.summary)
  const notice = useDriver((s) => s.notice)
  // the drive is computed in a second or two, the playback takes longer: the verdict waits until the agent gets there
  const arrived = usePlayback((s) => s.t >= s.duration - 0.5)
  const retryGuided = () => {
    setDriveMode('guided')
    usePlayback.getState().exit()
    startJourney()
  }
  const failed = summary && summary.outcome !== 'success'
  return (
    <div className="mt-1.5 space-y-1">
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {(phase === 'driving' || (phase === 'done' && !arrived)) && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {phase === 'driving' ? 'The model is driving, step by step' : 'Replaying what the model drove'}
        </p>
      )}
      {phase === 'done' && arrived && summary && (
        <div role="status" className={cn('flex items-start gap-2 rounded-xl border px-3 py-2 text-sm', summary.outcome === 'success' ? 'border-success/50' : 'border-warning/60')}>
          {summary.outcome === 'success' ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />}
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{outcomeText(summary.outcome)}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {Math.round(summary.pathM)} m driven vs {Math.round(summary.astarM)} m for A* · {summary.steps} steps
              {summary.blockedAttempts > 0 ? ` · ${summary.blockedAttempts} blocked moves` : ''}
            </p>
            {summary.total > 1 && (
              <p className="text-xs text-muted-foreground">
                Guided: {summary.reached} of {summary.total} waypoints reached
              </p>
            )}
            {failed && summary.outcome === 'stuck' && (
              <p className="text-xs text-muted-foreground">
                The model stopped getting closer to its goal, so the drive ended after about 2 s instead of waiting.{' '}
                {summary.mode === 'free' ? 'It only sees a small window around itself: waypoints from A* usually help.' : 'Between these waypoints it found a spot it cannot read with its small local view.'}
              </p>
            )}
            {failed && summary.mode === 'free' && (
              <button type="button" onClick={retryGuided} className="mt-1 inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                Retry in Guided
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
