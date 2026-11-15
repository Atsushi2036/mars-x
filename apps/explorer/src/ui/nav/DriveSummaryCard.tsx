import { outcomeText, useDriver } from '@/store/driver'
import { usePlayback } from '@/store/playback'
import { CircleAlert, CircleCheck, LoaderCircle } from '@/ui/icons'
import { cn } from '@/lib/utils'

/** While the AI drives: a status line (and the long-route warning). When it ends: reached or not, distance against A*, steps and outcome. */
export function DriveSummaryCard() {
  const phase = useDriver((s) => s.phase)
  const summary = useDriver((s) => s.summary)
  const notice = useDriver((s) => s.notice)
  // the drive is computed in a second or two, the playback takes longer: the verdict waits until the agent gets there
  const arrived = usePlayback((s) => s.t >= s.duration - 0.5)
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
          <div className="min-w-0">
            <p className="font-medium">{outcomeText(summary.outcome)}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {Math.round(summary.pathM)} m driven vs {Math.round(summary.astarM)} m for A* · {summary.steps} steps
              {summary.blockedAttempts > 0 ? ` · ${summary.blockedAttempts} blocked moves` : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
