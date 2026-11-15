import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { fmtClock } from '@/features/shared/fmt'
import { useScenario } from '@/features/scenario/store'
import { setSun, useApp } from '@/store/app'
import { DAY_SPEEDS, type DaySpeed } from '@/store/day-clock'
import { useDay } from '@/store/day'
import { Section } from './Section'

/**
 * Sun and shadows. The scenario (sol and local time, Mars24 tables) drives the sun; this section animates
 * the day and offers a clearly labelled manual override for exploring geometry by hand.
 */
export function SunSection() {
  const sun = useApp((s) => s.sun)
  const manual = useApp((s) => s.sunMode === 'manual')
  const setMode = useApp((s) => s.setSunMode)
  const sol = useScenario((s) => s.sol)
  const lmstH = useScenario((s) => s.lmstH)
  const playing = useDay((s) => s.playing)
  const setPlaying = useDay((s) => s.setPlaying)
  const speed = useDay((s) => s.speed)
  const setSpeed = useDay((s) => s.setSpeed)
  const hasSol = sol !== null
  const night = sun.elevationDeg <= 0

  return (
    <Section
      title="Sun and shadows"
      hint={hasSol ? `From the Mars24 sun model for sol ${sol}. Shadows follow the time of day.` : 'The selected scenario has no sol, so there is no sun table. Pick an L2 scenario, or use the manual override.'}
    >
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="h-10 flex-1 gap-1.5 md:h-8"
          disabled={!hasSol || manual}
          aria-pressed={playing}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? 'Pause day' : 'Play day'}
        </Button>
        <ToggleGroup
          type="single"
          value={speed}
          onValueChange={(v) => v && setSpeed(v as DaySpeed)}
          variant="outline"
          spacing={0}
          aria-label="Day animation speed"
        >
          {(Object.keys(DAY_SPEEDS) as DaySpeed[]).map((k) => (
            <ToggleGroupItem key={k} value={k} className="h-10 px-2 text-xs capitalize md:h-8" title={`A full sol in ${DAY_SPEEDS[k]} s`}>
              {k}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <dl className="grid grid-cols-3 gap-2 rounded-lg border border-border px-3 py-2 text-xs" aria-live="off">
        <div>
          <dt className="text-muted-foreground">Local time</dt>
          <dd className="font-mono text-sm tabular-nums">{hasSol && !manual ? fmtClock(lmstH) : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sun azimuth</dt>
          <dd className="font-mono text-sm tabular-nums">{Math.round(sun.azimuthDeg)}°</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Elevation</dt>
          <dd className="font-mono text-sm tabular-nums">{night ? 'Night' : `${Math.round(sun.elevationDeg)}°`}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3 pt-0.5">
        <label htmlFor="sun-manual" className="text-xs">
          Manual override
          <span className="block text-[11px] text-muted-foreground">Replaces the scenario sun with your own angles</span>
        </label>
        <Switch
          id="sun-manual"
          checked={manual}
          onCheckedChange={(on) => {
            setMode(on ? 'manual' : 'scenario')
            if (on) setPlaying(false)
          }}
        />
      </div>
      {manual && (
        <div className="space-y-3 border-l-2 border-primary/50 pl-3">
          <label className="block space-y-1.5 text-xs">
            <span className="flex justify-between text-muted-foreground">
              Azimuth <span className="font-mono tabular-nums text-foreground">{Math.round(sun.azimuthDeg)}°</span>
            </span>
            <Slider min={0} max={359} step={1} value={[sun.azimuthDeg]} onValueChange={([v]) => setSun(v ?? 0, sun.elevationDeg, 'manual')} aria-label="Sun azimuth" />
          </label>
          <label className="block space-y-1.5 text-xs">
            <span className="flex justify-between text-muted-foreground">
              Elevation <span className="font-mono tabular-nums text-foreground">{Math.round(sun.elevationDeg)}°</span>
            </span>
            <Slider min={-5} max={80} step={1} value={[sun.elevationDeg]} onValueChange={([v]) => setSun(sun.azimuthDeg, v ?? 0, 'manual')} aria-label="Sun elevation" />
          </label>
        </div>
      )}
    </Section>
  )
}
