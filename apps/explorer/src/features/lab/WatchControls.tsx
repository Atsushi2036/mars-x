import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { Brain, Eye, Gauge, Sparkles } from '@/ui/icons'
import { Chip } from '@/ui/kit'
import type { StageView } from './TrainStage'
import { exploreShare, type WatchSpeed } from './watch'

const SPEEDS: Array<{ id: WatchSpeed; label: string }> = [
  { id: 'slow', label: 'Slow' },
  { id: 'fast', label: 'Fast' },
  { id: 'turbo', label: 'Turbo' },
]

/** "Watch training" switch and its speed on one row. Off = train at full speed with no animation. */
export function WatchSwitch({ on, onChange, speed, onSpeed }: { on: boolean; onChange: (v: boolean) => void; speed: WatchSpeed; onSpeed: (s: WatchSpeed) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label htmlFor="watch-training" className="flex shrink-0 items-center gap-1.5 text-sm font-medium">
        <Eye className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        Watch
      </label>
      <Switch id="watch-training" aria-label="Watch training" checked={on} onCheckedChange={onChange} />
      <ToggleGroup type="single" value={speed} onValueChange={(v) => v && onSpeed(v as WatchSpeed)} variant="outline" spacing={0} className="min-w-0 flex-1" aria-label="Watch speed" disabled={!on}>
        {SPEEDS.map((s) => (
          <ToggleGroupItem key={s.id} value={s.id} className="h-10 flex-1 px-1 text-sm data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">
            {s.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

const VIEWS: Array<{ id: StageView; label: string }> = [
  { id: 'map', label: 'Paths' },
  { id: 'value', label: 'Value' },
  { id: 'policy', label: 'Best moves' },
]

const VIEW_LEGEND: Record<StageView, string> = {
  map: 'Cyan is A*, the best path. Amber is what the agent would do now.',
  value: 'Brighter = the agent expects more reward from here.',
  policy: 'Each arrow is the best move the agent has found in that cell.',
}

/** What the agent has learned: value map V(s) or the policy arrows. One legend line. */
export function ViewSwitch({ view, onView }: { view: StageView; onView: (v: StageView) => void }) {
  return (
    <div className="space-y-1.5">
      <ToggleGroup type="single" value={view} onValueChange={(v) => v && onView(v as StageView)} variant="outline" spacing={0} className="w-full" aria-label="What to show on the map">
        {VIEWS.map((v) => (
          <ToggleGroupItem key={v.id} value={v.id} className="h-10 flex-1 text-sm data-[state=on]:bg-primary! data-[state=on]:text-primary-foreground!">
            {v.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{VIEW_LEGEND[view]}</p>
    </div>
  )
}

/** Exploring vs exploiting: the share of random moves (epsilon) as a two-part bar. */
export function ExploreBar({ epsilon }: { epsilon: number | null }) {
  const e = epsilon === null ? null : exploreShare(epsilon)
  return (
    <div className="space-y-1.5" role="group" aria-label="Exploring versus exploiting">
      <div className="flex items-baseline justify-between text-sm">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-agent" strokeWidth={1.75} aria-hidden="true" /> Exploring {e === null ? '—' : `${Math.round(e * 100)}%`}
        </span>
        <span className="flex items-center gap-1.5">
          Exploiting {e === null ? '—' : `${Math.round((1 - e) * 100)}%`} <Brain className="size-4 text-planner" strokeWidth={1.75} aria-hidden="true" />
        </span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div className="bg-agent transition-[width] duration-[var(--dur-slow)]" style={{ width: `${(e ?? 0) * 100}%` }} />
        <div className="bg-planner/70 flex-1" />
      </div>
    </div>
  )
}

const CONCEPTS = [
  { id: 'reward', label: 'Reward', icon: Gauge, line: 'Points it gets: a small cost per step, a big prize at the goal, a penalty for hitting a wall.' },
  { id: 'eps', label: 'Exploration (ε)', icon: Sparkles, line: 'How often it tries a random move instead of its best one. It falls as it learns.' },
  { id: 'q', label: 'Q-value', icon: Brain, line: 'Its guess of the total reward it will collect from here if it plays well.' },
] as const

/** Three foldable chips, one line each. */
export function ConceptChips() {
  const [open, setOpen] = useState<string | null>(null)
  const cur = CONCEPTS.find((c) => c.id === open)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="What these words mean">
        {CONCEPTS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-expanded={open === c.id}
            onClick={() => setOpen(open === c.id ? null : c.id)}
            className={cn('rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          >
            <Chip icon={c.icon} tone={open === c.id ? 'primary' : 'neutral'} className="h-8 cursor-pointer px-3 text-sm">
              {c.label}
            </Chip>
          </button>
        ))}
      </div>
      {cur && (
        <p role="status" className="text-sm text-muted-foreground">
          {cur.line}
        </p>
      )}
    </div>
  )
}

/** Two big numbers side by side: the episode being learned and the success rate over the last 100. */
export function StatStrip({ episode, seconds, success }: { episode: number | null; seconds: number; success: number | null }) {
  return (
    <div className="grid grid-cols-2 gap-2" aria-live="polite">
      <div className="rounded-2xl border border-border bg-surface/60 px-3.5 py-2">
        <p className="text-xs text-muted-foreground">Episode</p>
        <p className="flex items-baseline gap-1.5 text-2xl font-semibold leading-8 tabular-nums">
          {episode === null ? '—' : episode.toLocaleString('en-US')}
          {episode !== null && <span className="text-sm font-normal text-muted-foreground">{Math.round(seconds)} s</span>}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-surface/60 px-3.5 py-2">
        <p className="text-xs text-muted-foreground">Success, last 100</p>
        <p className="text-2xl font-semibold leading-8 tabular-nums">
          {success === null ? '—' : Math.round(success * 100)}
          {success !== null && <span className="ml-0.5 text-sm font-normal text-muted-foreground">%</span>}
        </p>
      </div>
    </div>
  )
}
