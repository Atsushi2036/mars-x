import { useScenario } from '@/features/scenario/store'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { setSun, useApp } from '@/store/app'
import { DAY_SPEEDS, type DaySpeed } from '@/store/day-clock'
import { useDay } from '@/store/day'
import { Pause, Play } from '../icons'

/** Play the sol: one button and a speed switch. The sun itself comes from the scenario (Mars24 tables). */
export function DayPlayer() {
  const manual = useApp((s) => s.sunMode === 'manual')
  const sol = useScenario((s) => s.sol)
  const playing = useDay((s) => s.playing)
  const setPlaying = useDay((s) => s.setPlaying)
  const speed = useDay((s) => s.speed)
  const setSpeed = useDay((s) => s.setSpeed)
  const hasSol = sol !== null
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" className="h-10 flex-1 gap-2" disabled={!hasSol || manual} aria-pressed={playing} onClick={() => setPlaying(!playing)}>
        {playing ? <Pause className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
        {playing ? 'Pause day' : 'Play day'}
      </Button>
      <ToggleGroup type="single" value={speed} onValueChange={(v) => v && setSpeed(v as DaySpeed)} variant="outline" spacing={0} aria-label="Day animation speed">
        {(Object.keys(DAY_SPEEDS) as DaySpeed[]).map((k) => (
          <ToggleGroupItem key={k} value={k} className="h-10 px-2.5 text-sm capitalize" title={`A full sol in ${DAY_SPEEDS[k]} s`}>
            {k}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/** Manual sun override: replaces the scenario sun with your own angles. Kept behind "Advanced". */
export function SunOverride() {
  const sun = useApp((s) => s.sun)
  const manual = useApp((s) => s.sunMode === 'manual')
  const setMode = useApp((s) => s.setSunMode)
  const setPlaying = useDay((s) => s.setPlaying)
  const night = sun.elevationDeg <= 0
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 text-sm" aria-live="off">
        <div className="rounded-xl bg-surface px-3 py-2">
          <dt className="text-xs text-muted-foreground">Sun azimuth</dt>
          <dd className="tabular-nums">{Math.round(sun.azimuthDeg)}°</dd>
        </div>
        <div className="rounded-xl bg-surface px-3 py-2">
          <dt className="text-xs text-muted-foreground">Sun elevation</dt>
          <dd className="tabular-nums">{night ? 'Night' : `${Math.round(sun.elevationDeg)}°`}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="sun-manual" className="text-sm">
          Manual sun
          <span className="block text-xs text-muted-foreground">Use your own angles</span>
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
          <label className="block space-y-2 text-sm">
            <span className="flex justify-between text-muted-foreground">
              Azimuth <span className="tabular-nums text-foreground">{Math.round(sun.azimuthDeg)}°</span>
            </span>
            <Slider min={0} max={359} step={1} value={[sun.azimuthDeg]} onValueChange={([v]) => setSun(v ?? 0, sun.elevationDeg, 'manual')} aria-label="Sun azimuth" />
          </label>
          <label className="block space-y-2 text-sm">
            <span className="flex justify-between text-muted-foreground">
              Elevation <span className="tabular-nums text-foreground">{Math.round(sun.elevationDeg)}°</span>
            </span>
            <Slider min={-5} max={80} step={1} value={[sun.elevationDeg]} onValueChange={([v]) => setSun(sun.azimuthDeg, v ?? 0, 'manual')} aria-label="Sun elevation" />
          </label>
        </div>
      )}
    </div>
  )
}
