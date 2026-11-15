import { Info } from '@/ui/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { fmtDeg, fmtElevation, fmtLat, fmtLon } from '@/lib/format'
import { useApp } from '@/store/app'
import { useImmersive } from './wizard/immersive'

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="font-sans text-xs text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

const DISCLAIMER_SHORT = 'Not affiliated with NASA, JPL or Caltech'
const DISCLAIMER_LONG = 'Not affiliated with or endorsed by NASA, JPL or Caltech'

/** Bottom telemetry strip, 32 px (Geist Mono, tabular). Reads the point under the camera / orbit target. */
export function TelemetryBar() {
  const t = useApp((s) => s.telemetry)
  const ready = useApp((s) => s.progress.ready >= 1)
  const setMode = useApp((s) => s.setMode)
  const immersive = useImmersive()
  const dash = '—'
  return (
    <div
      role="status"
      aria-label="Telemetry"
      data-cover="bottom"
      data-chrome="bottom"
      className={`pointer-events-auto absolute inset-x-0 z-20 flex h-8 items-center gap-x-4 overflow-hidden border-t border-border bg-background/90 px-3 font-mono text-[13px] tabular-nums backdrop-blur-md md:bottom-0 md:px-4 ${immersive ? 'bottom-0 pb-[env(safe-area-inset-bottom)] max-md:h-[calc(2rem+env(safe-area-inset-bottom))]' : 'bottom-16'}`}
    >
      {/* phones: one coordinate string, the disclaimer sits behind the info button */}
      <div className="flex min-w-0 flex-1 items-center gap-3 md:hidden">
        <span className="truncate text-foreground">{ready ? `${fmtLat(t.lat)} ${fmtLon(t.lon)}` : dash}</span>
        <span className="ml-auto text-muted-foreground">{ready ? `${t.fps.toFixed(0)} fps` : dash}</span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="About this data"
              className="-mr-2 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="size-5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-72 font-sans">
            <p className="text-sm">{DISCLAIMER_LONG}</p>
            <button
              type="button"
              onClick={() => setMode('data')}
              className="mt-2 text-sm font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sources and credits
            </button>
          </PopoverContent>
        </Popover>
      </div>

      <div className="hidden min-w-0 flex-1 items-center gap-x-5 md:flex">
        <Cell label="Lat" value={ready ? fmtLat(t.lat) : dash} />
        <Cell label="Lon" value={ready ? fmtLon(t.lon) : dash} />
        <Cell label="Elev" value={ready ? fmtElevation(t.elevation) : dash} />
        <Cell label="Slope" value={ready ? fmtDeg(t.slopeDeg) : dash} />
      </div>
      <div className="hidden items-center gap-x-4 font-sans md:flex">
        <button
          type="button"
          onClick={() => setMode('data')}
          className="text-xs font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sources
        </button>
        <span className="text-xs text-muted-foreground">{DISCLAIMER_SHORT}</span>
        <span className="font-mono text-xs text-muted-foreground">{ready ? `${t.fps.toFixed(0)} fps` : dash}</span>
      </div>
    </div>
  )
}
