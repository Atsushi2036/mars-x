import { useId, useMemo, useState } from 'react'
import { fmtNum } from '../shared/fmt'
import { niceTicks, type ChartPoint } from './curve'

const W = 320
const H = 168
const M = { l: 38, r: 8, t: 8, b: 24 }

/**
 * Return per episode: one idea, one axis. The faint line is the bucket mean, the solid line a moving average.
 * Hover (or arrow keys) reads out the exact values; a data table is available for screen readers.
 */
export function RewardChart({ points }: { points: ChartPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()
  const geo = useMemo(() => {
    if (points.length === 0) return null
    const ys = points.flatMap((p) => [p.raw, p.smooth])
    const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys))
    const x0 = points[0]!.episode
    const x1 = points[points.length - 1]!.episode
    const sx = (e: number) => M.l + (x1 === x0 ? 0.5 : (e - x0) / (x1 - x0)) * (W - M.l - M.r)
    const sy = (v: number) => H - M.b - ((v - lo) / (hi - lo || 1)) * (H - M.t - M.b)
    const path = (k: 'raw' | 'smooth') => points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.episode).toFixed(1)} ${sy(p[k]).toFixed(1)}`).join('')
    const xt = niceTicks(x0, x1, 3).ticks.filter((t) => t >= x0 && t <= x1)
    return { ticks, sx, sy, raw: path('raw'), smooth: path('smooth'), xt, x0, x1 }
  }, [points])

  if (!geo) {
    return (
      <div className="grid h-[168px] place-items-center rounded-lg border border-dashed border-input text-xs text-muted-foreground">
        The curve appears here once training starts.
      </div>
    )
  }
  const hp = hover !== null ? points[Math.min(hover, points.length - 1)]! : null
  const last = points[points.length - 1]!
  const rows = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 8)) === 0 || i === points.length - 1)

  const at = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect()
    const x = ((clientX - r.left) / r.width) * W
    const frac = (x - M.l) / (W - M.l - M.r)
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(frac * (points.length - 1)))))
  }

  return (
    <figure className="space-y-1.5">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          className="block h-auto w-full touch-pan-y rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerMove={(e) => at(e.clientX, e.currentTarget)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? points.length - 1) - 1))
            else if (e.key === 'ArrowRight') setHover((h) => Math.min(points.length - 1, (h ?? 0) + 1))
            else if (e.key === 'Escape') setHover(null)
          }}
          onBlur={() => setHover(null)}
        >
          <title id={titleId}>{`Return per episode over ${fmtNum(last.episode, 0)} episodes. Latest moving average ${fmtNum(last.smooth, 1)}.`}</title>
          {geo.ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={geo.sy(t)} y2={geo.sy(t)} className="stroke-border" strokeWidth={1} />
              <text x={M.l - 5} y={geo.sy(t)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground font-mono text-[9px]">
                {fmtNum(t, Math.abs(t) < 10 && !Number.isInteger(t) ? 1 : 0)}
              </text>
            </g>
          ))}
          {geo.xt.map((t) => (
            <text key={t} x={geo.sx(t)} y={H - 8} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
              {fmtNum(t, 0)}
            </text>
          ))}
          <path d={geo.raw} fill="none" className="stroke-chart-1" strokeOpacity={0.35} strokeWidth={1} strokeLinejoin="round" />
          <path d={geo.smooth} fill="none" className="stroke-chart-1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <g>
              <line x1={geo.sx(hp.episode)} x2={geo.sx(hp.episode)} y1={M.t} y2={H - M.b} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={geo.sx(hp.episode)} cy={geo.sy(hp.smooth)} r={4} className="fill-chart-1 stroke-card" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hp && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-border bg-popover px-2 py-1 font-mono text-[10.5px] leading-4 text-popover-foreground shadow-md"
            style={{ left: `${Math.min(62, Math.max(0, (geo.sx(hp.episode) / W) * 100 - 14))}%` }}
          >
            <div>Episode {fmtNum(hp.episode, 0)}</div>
            <div>Return {fmtNum(hp.smooth, 1)} (avg)</div>
            <div>Goal reached {Math.round(hp.success * 100)}%</div>
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-chart-1" aria-hidden="true" /> Moving average
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-px w-4 bg-chart-1/40" aria-hidden="true" /> Per episode
          </span>
        </span>
        <span>Episodes →</span>
      </figcaption>
      <details className="text-[11px] text-muted-foreground">
        <summary className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">Data table</summary>
        <table className="mt-1 w-full font-mono tabular-nums">
          <thead>
            <tr className="text-left">
              <th className="font-medium">Episode</th>
              <th className="font-medium">Return</th>
              <th className="font-medium">Goal reached</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.episode}>
                <td>{fmtNum(p.episode, 0)}</td>
                <td>{fmtNum(p.smooth, 1)}</td>
                <td>{Math.round(p.success * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
