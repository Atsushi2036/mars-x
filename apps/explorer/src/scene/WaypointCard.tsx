import { X } from 'lucide-react'
import { useApp } from '@/store/app'

const f1 = (v: number) => v.toFixed(1).replace('-', '−')

/** Details of the picked Perseverance waypoint: the rover's measured attitude next to the slope the DEM gives at that spot. */
export function WaypointCard() {
  const w = useApp((s) => s.selectedWaypoint)
  const hf = useApp((s) => s.dataset?.heightfield)
  const clear = useApp((s) => s.setSelectedWaypoint)
  if (!w) return null
  const demSlope = hf ? hf.slopeDegAt(w.x, w.z) : null
  return (
    <aside
      aria-label="Selected Perseverance waypoint"
      className="pointer-events-auto absolute left-3 top-14 z-20 w-60 rounded-lg border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold leading-5">Sol {w.sol}</p>
          <p className="text-muted-foreground">
            Site {w.site}, drive {w.drive}
          </p>
        </div>
        <button
          type="button"
          onClick={() => clear(null)}
          aria-label="Close waypoint details"
          className="-mr-1 -mt-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <dl className="mt-2 space-y-1 font-mono tabular-nums">
        <div className="flex justify-between gap-3">
          <dt className="font-sans text-muted-foreground">Measured tilt</dt>
          <dd>{f1(w.tiltDeg)}°</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-sans text-muted-foreground">Pitch / roll</dt>
          <dd>
            {f1(w.pitchDeg)}° / {f1(w.rollDeg)}°
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-sans text-muted-foreground">DEM slope here</dt>
          <dd>{demSlope === null ? '—' : `${f1(demSlope)}°`}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-sans text-muted-foreground">Odometry</dt>
          <dd>{Math.round(w.distTotalM).toLocaleString('en-US')} m</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Tilt is the rover&apos;s own measurement; the DEM slope is the 1 m terrain model at this point. Source: NASA/JPL-Caltech, Mars 2020 MMGIS.
      </p>
    </aside>
  )
}
