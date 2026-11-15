import { useEffect, useRef } from 'react'
import { agentLive, cameraRig, flyTo, resetNorth, useCamera, zoomBy } from '@/store/camera'
import { PITCH_MAX } from '@/store/camera-math'
import { roverLive } from '@/store/rover'
import { cn } from '@/lib/utils'
import { LocateFixed, Minus, Plus } from '@/ui/icons'
import { flashNotice } from './store'

const STEP = 0.75
const btn =
  'glass pointer-events-auto grid size-11 place-items-center rounded-full text-foreground outline-none transition-colors duration-[var(--dur-fast)] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-40'

/** Compass: the needle follows the camera heading (updated from the rig, no React renders); click = north up, shift-click = also top-down. */
function Compass() {
  const needle = useRef<SVGSVGElement>(null)
  const mode = useCamera((s) => s.mode)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (t - last < 50 || !needle.current) return
      last = t
      needle.current.style.transform = `rotate(${cameraRig.azimuth}rad)`
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <button
      type="button"
      aria-label="Compass: north up (N)"
      title="North up (N). Shift-click also looks straight down."
      disabled={mode === 'chase'}
      onClick={(e) => (e.shiftKey ? flyTo({ yaw: 0, pitch: PITCH_MAX }, 500) : resetNorth())}
      className={cn(btn, 'relative size-11')}
    >
      <svg ref={needle} viewBox="0 0 40 40" className="size-9 will-change-transform" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M20 5l5 15h-10z" fill="var(--agent)" />
        <path d="M20 35l-5-15h10z" fill="currentColor" fillOpacity="0.4" />
        <text x="20" y="3.2" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="var(--card)" strokeWidth="2" paintOrder="stroke">
          N
        </text>
      </svg>
    </button>
  )
}

function ZoomButton({ dir, label, children }: { dir: -1 | 1; label: string; children: React.ReactNode }) {
  const mode = useCamera((s) => s.mode)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stop = () => {
    clearTimeout(timer.current)
    cameraRig.zoomHold = 0
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (hold to keep zooming)`}
      disabled={mode !== 'orbit'}
      className={btn}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        zoomBy(dir < 0 ? STEP : 1 / STEP)
        timer.current = setTimeout(() => (cameraRig.zoomHold = dir < 0 ? -1 : 1), 380)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          zoomBy(dir < 0 ? STEP : 1 / STEP)
        }
      }}
    >
      {children}
    </button>
  )
}

/** Vertical column of round map controls: zoom in, zoom out, recentre on the agent, compass. */
export function ZoomCluster() {
  const mode = useCamera((s) => s.mode)
  return (
    <div role="group" aria-label="Map controls" className="flex flex-col items-center gap-2">
      <ZoomButton dir={-1} label="Zoom in">
        <Plus className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </ZoomButton>
      <ZoomButton dir={1} label="Zoom out">
        <Minus className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </ZoomButton>
      <button
        type="button"
        aria-label="Centre on the rover (F)"
        title="Centre on the rover (F)"
        className={btn}
        onClick={() => {
          const a = agentLive.ready ? agentLive : roverLive
          if (mode === 'orbit') flyTo({ x: a.x, z: a.z, dist: Math.min(cameraRig.pose.dist || 140, 140) }, 900)
          else if (mode === 'fpv') flyTo({ x: a.x, z: a.z }, 0)
          else flashNotice('Follow already tracks the rover. Press 1 for Orbit.')
        }}
      >
        <LocateFixed className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Compass />
    </div>
  )
}
