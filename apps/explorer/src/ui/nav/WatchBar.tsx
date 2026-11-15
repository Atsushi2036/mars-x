import { useApp } from '@/store/app'
import { useMission } from '@/store/mission'
import { useRover } from '@/store/rover'
import { SPEEDS, usePlayback, type EventKind } from '@/store/playback'
import { currentWatchTarget, startWatch } from '@/store/watch'
import { useReplay } from '@/features/replay/store'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { DriverChip } from './DriverChip'
import { DriveSummaryCard } from './DriveSummaryCard'
import { useDriver } from '@/store/driver'
import { BatteryLow, Flag, Mountain, OctagonX, Pause, Play, SkipBack, Sun, X, type LucideIcon } from '@/ui/icons'

const MARK: Record<EventKind, { icon: LucideIcon; tone: string }> = {
  rock: { icon: Mountain, tone: 'text-foreground' },
  spe: { icon: Sun, tone: 'text-brand' },
  'low-energy': { icon: BatteryLow, tone: 'text-brand' },
  stuck: { icon: OctagonX, tone: 'text-destructive' },
  end: { icon: Flag, tone: 'text-foreground' },
}

/** The amber call to action: appears when there is a planned route or a replay episode to watch. */
export function WatchButton() {
  const mode = useApp((s) => s.mode)
  // re-evaluate when any input of the decision changes
  useMission((s) => s.outcomes)
  useMission((s) => s.profile)
  useMission((s) => s.layers)
  useReplay((s) => s.status)
  useRover((s) => s.status)
  const target = currentWatchTarget(mode)
  const phase = useDriver((s) => s.phase)
  if (!target) return null
  const loading = phase === 'loading'
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
      type="button"
      disabled={loading}
      onClick={() => startWatch(mode)}
      className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-float outline-none transition-transform duration-[var(--dur-fast)] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
    >
      <Play className="size-5" strokeWidth={2} fill="currentColor" aria-hidden="true" />
      {loading ? 'Loading the model…' : target.label}
      </button>
    </div>
  )
}

/** Playback bar: replaces the dock while watching. Restart, play/pause (Space), speed, scrubber with event markers, Exit (Esc). */
export function WatchBar() {
  const s = usePlayback()
  if (!s.source) return null
  const pct = (t: number) => (s.duration > 0 ? Math.min(100, Math.max(0, (t / s.duration) * 100)) : 0)
  const atEnd = s.t >= s.duration
  return (
    <div role="group" aria-label="Playback" className="glass pointer-events-auto flex w-[min(30rem,calc(100vw-1.5rem))] flex-col gap-1.5 rounded-2xl p-2 pb-2.5 max-md:w-[calc(100vw-1.5rem)]">
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Restart" title="Restart" onClick={s.restart} className={ctl}>
          <SkipBack className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={s.playing ? 'Pause (Space)' : atEnd ? 'Replay (Space)' : 'Play (Space)'}
          title={s.playing ? 'Pause (Space)' : 'Play (Space)'}
          data-playpause onClick={s.toggle}
          className={cn(ctl, 'bg-brand text-brand-foreground hover:bg-brand hover:brightness-105')}
        >
          {s.playing ? <Pause className="size-5" strokeWidth={2} fill="currentColor" aria-hidden="true" /> : <Play className="size-5" strokeWidth={2} fill="currentColor" aria-hidden="true" />}
        </button>
        <div role="radiogroup" aria-label="Speed" className="flex rounded-lg bg-muted p-0.5">
          {SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={s.speed === v}
              onClick={() => s.setSpeed(v)}
              className={cn(
                'h-10 min-w-11 rounded-md px-2 text-sm font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:min-w-9',
                s.speed === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v}×
            </button>
          ))}
        </div>
        {s.source === 'route' && s.timeScale * s.speed > 1.05 && (
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline" title="Playback runs faster than the real mission">
            {Math.round(s.timeScale * s.speed)}× sped up
          </span>
        )}
        <button type="button" onClick={s.exit} aria-label="Exit Watch (Esc)" title="Exit (Esc)" className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-9">
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
          Exit
        </button>
      </div>
      <div className="px-2">
        <div className="relative h-5" aria-hidden={s.events.length === 0}>
          {s.events.map((e, i) => {
            const m = MARK[e.kind]
            return (
              <button
                key={`${e.kind}-${e.t}-${i}`}
                type="button"
                title={e.label}
                aria-label={`${e.label}, jump to it`}
                onClick={() => s.seek(e.t)}
                style={{ left: `${pct(e.t)}%` }}
                className="absolute top-0 grid size-6 -translate-x-1/2 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <m.icon className={cn('size-4', m.tone)} strokeWidth={2} aria-hidden="true" />
              </button>
            )
          })}
        </div>
        <Slider
          aria-label="Playback position"
          min={0}
          max={Math.max(1, s.duration)}
          step={s.source === 'run' ? 0.5 : 0.1}
          value={[Math.min(s.t, Math.max(1, s.duration))]}
          onValueChange={([v]) => v !== undefined && s.seek(v)}
          className="touch-none py-2.5"
        />
        {s.source === 'route' && <DriverChip className="mt-1" />}
        {s.ai && <DriveSummaryCard />}
        <p className="mt-0.5 flex justify-between font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
          <span>{s.label(s.t)}</span>
          <span>{s.source === 'route' ? `of ${s.label(s.duration)} mission time` : s.events.at(-1)?.label}</span>
        </p>
      </div>
    </div>
  )
}

const ctl = 'grid size-11 place-items-center rounded-lg text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:size-9'
