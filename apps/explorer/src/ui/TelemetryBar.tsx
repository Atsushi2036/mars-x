import { useApp } from '@/store/app'
import { useCamera } from '@/store/camera'
import { fmtDeg, fmtElevation, fmtLat, fmtLon } from '@/lib/format'

function Cell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex items-baseline gap-1.5 whitespace-nowrap ${className}`}>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

const MODE_LABEL = { orbit: 'Orbit', fpv: 'First person', chase: 'Follow rover' } as const

/** Bottom telemetry strip (Geist Mono, tabular). Reads the point under the camera / orbit target. */
export function TelemetryBar() {
  const t = useApp((s) => s.telemetry)
  const ready = useApp((s) => s.progress.ready >= 1)
  const cam = useCamera((s) => s.mode)
  const dash = '—'
  return (
    <div
      role="status"
      aria-label="Telemetry"
      className="pointer-events-auto absolute inset-x-0 bottom-16 z-20 flex h-[3.25rem] flex-col justify-center overflow-hidden border-t border-border/70 bg-background/80 px-3 font-mono text-xs tabular-nums backdrop-blur-md md:bottom-0 md:h-9 md:flex-row md:items-center md:gap-x-4 md:px-4"
    >
      <div className="flex min-w-0 items-center gap-x-4 md:contents">
        <Cell label="LAT" value={ready ? fmtLat(t.lat) : dash} />
        <Cell label="LON" value={ready ? fmtLon(t.lon) : dash} />
        <Cell label="ELEV" value={ready ? fmtElevation(t.elevation) : dash} className="hidden min-[420px]:flex" />
        <Cell label="SLOPE" value={ready ? fmtDeg(t.slopeDeg) : dash} className="hidden min-[520px]:flex" />
        <div className="ml-auto flex items-baseline gap-4 md:hidden">
          <Cell label="FPS" value={ready ? t.fps.toFixed(0) : dash} />
        </div>
      </div>
      {/* the disclaimer is always on screen: second row on phones, inline from md up */}
      <button
        type="button"
        onClick={() => useApp.getState().setMode('data')}
        className="mt-0.5 block truncate text-left font-sans text-[10px] leading-4 text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring md:ml-auto md:mt-0 md:whitespace-nowrap md:text-[11px]"
      >
        <span className="md:hidden">Not affiliated with or endorsed by NASA, JPL or Caltech</span>
        <span className="hidden md:inline">Sources. Not affiliated with NASA, JPL or Caltech</span>
      </button>
      <div className="hidden items-baseline gap-4 md:flex">
        <Cell label="CAM" value={MODE_LABEL[cam]} />
        <Cell label="FPS" value={ready ? t.fps.toFixed(0) : dash} />
      </div>
    </div>
  )
}
