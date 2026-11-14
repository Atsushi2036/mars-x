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
      className="pointer-events-auto absolute inset-x-0 bottom-16 z-20 flex h-9 items-center gap-x-4 overflow-hidden border-t border-border/70 bg-background/80 px-3 font-mono text-xs tabular-nums backdrop-blur-md md:bottom-0 md:px-4"
    >
      <Cell label="LAT" value={ready ? fmtLat(t.lat) : dash} />
      <Cell label="LON" value={ready ? fmtLon(t.lon) : dash} />
      <Cell label="ELEV" value={ready ? fmtElevation(t.elevation) : dash} className="hidden min-[420px]:flex" />
      <Cell label="SLOPE" value={ready ? fmtDeg(t.slopeDeg) : dash} className="hidden min-[520px]:flex" />
      <div className="ml-auto flex items-baseline gap-4">
        <Cell label="CAM" value={MODE_LABEL[cam]} className="hidden md:flex" />
        <Cell label="FPS" value={ready ? t.fps.toFixed(0) : dash} />
      </div>
    </div>
  )
}
