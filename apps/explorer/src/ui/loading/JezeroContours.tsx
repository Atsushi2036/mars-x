import data from './jezero-contours.json'

type Contours = { size: number; levels: number[][][] }
const C = data as Contours

/** One SVG path per polyline, in the 0..1000 box of the generated file. */
const PATHS: { d: string; level: number }[] = C.levels.flatMap((lines, level) =>
  lines.map((l) => {
    let d = `M${l[0]} ${l[1]}`
    for (let i = 2; i < l.length; i += 2) d += `L${l[i]} ${l[i + 1]}`
    return { d, level }
  }),
)
const LEVELS = C.levels.length

/**
 * Real isolines of the Jezero DEM (see scripts/make-jezero-contours.mjs). They draw themselves with the load progress:
 * level k is complete when progress reaches (k + 1) / levels, so the drawn length follows the real progress.
 */
export function JezeroContours({ progress }: { progress: number }) {
  return (
    <svg viewBox="0 0 1000 1000" className="size-full" fill="none" aria-hidden="true">
      {PATHS.map((p, i) => {
        const f = Math.min(1, Math.max(0, progress * LEVELS - p.level))
        return (
          <path
            key={i}
            d={p.d}
            pathLength={1}
            stroke={p.level % 2 ? '#9fe3f5' : '#ffd9b8'}
            strokeOpacity={0.7 + (p.level / LEVELS) * 0.3}
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={1}
            strokeDashoffset={1 - f}
            style={{ transition: 'stroke-dashoffset 450ms var(--ease-out)' }}
          />
        )
      })}
    </svg>
  )
}
