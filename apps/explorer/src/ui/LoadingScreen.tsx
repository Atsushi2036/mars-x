import { useEffect, useState } from 'react'
import { Check } from '@/ui/icons'
import { useApp } from '@/store/app'
import { LogoMark } from './Logo'

const STAGES = [
  { id: 'manifest', label: 'Dataset manifest', status: 'Reading the dataset manifest' },
  { id: 'elevation', label: 'Elevation model', status: 'Reading elevation model' },
  { id: 'mesh', label: 'Terrain mesh', status: 'Building terrain mesh' },
  { id: 'ortho', label: 'Orbital imagery', status: 'Loading orbital imagery' },
] as const

const RINGS = 6

/** Six nested, slightly irregular closed contours (a topographic hint of a crater), as SVG path data in a 200x200 box. */
function contourPaths(): string[] {
  const out: string[] = []
  for (let k = 0; k < RINGS; k++) {
    const r = 18 + k * 15
    const pts: string[] = []
    const N = 72
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const wob = 1 + 0.11 * Math.sin(3 * a + k * 0.9) + 0.06 * Math.sin(5 * a - k * 1.7) + 0.03 * Math.sin(8 * a + k)
      const x = 100 + Math.cos(a) * r * wob * 1.12
      const y = 100 + Math.sin(a) * r * wob * 0.9
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    out.push(pts.join('') + 'Z')
  }
  return out
}

const PATHS = contourPaths()

/**
 * Full-screen loader with REAL progress: the contour rings draw themselves as the data arrives (drawn length = overall
 * progress), one status line names the stage in flight, four dots tick off as stages finish. Fades out once the scene is ready.
 */
export function LoadingScreen() {
  const progress = useApp((s) => s.progress)
  const ready = progress.ready >= 1
  const [gone, setGone] = useState(false)
  const paths = PATHS

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setGone(true), 450)
    return () => clearTimeout(t)
  }, [ready])
  if (gone) return null

  const overall = STAGES.reduce((a, s) => a + Math.min(1, progress[s.id]), 0) / STAGES.length
  const pct = Math.round(overall * 100)
  const current = STAGES.find((s) => progress[s.id] < 1) ?? STAGES[STAGES.length - 1]!
  const status = ready ? 'Ready' : `${current.status}… ${pct} %`

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading, ${pct} percent`}
      data-progress={pct}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-background p-5 transition-opacity duration-500 ${ready ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <div className="relative grid w-[min(70vw,22rem)] place-items-center">
        <svg viewBox="0 0 200 200" className="w-full" fill="none" aria-hidden="true">
          {paths.map((d, i) => {
            // ring i draws while overall goes from i/RINGS to (i+1)/RINGS, so the total drawn length equals the progress
            const f = Math.min(1, Math.max(0, overall * RINGS - i))
            return (
              <path
                key={i}
                d={d}
                pathLength={1}
                stroke="var(--primary)"
                strokeOpacity={0.35 + (i / RINGS) * 0.65}
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeDasharray={1}
                strokeDashoffset={1 - f}
                style={{ transition: 'stroke-dashoffset 400ms var(--ease-out)' }}
              />
            )
          })}
        </svg>
        <LogoMark className="absolute size-16" />
      </div>

      <p className="mt-6 text-base font-medium tabular-nums">{status}</p>

      <ol className="mt-4 flex items-center gap-4" aria-label="Loading stages">
        {STAGES.map((s) => {
          const done = progress[s.id] >= 1
          return (
            <li key={s.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`grid size-4 place-items-center rounded-full border ${done ? 'border-success bg-success/15 text-success' : 'border-border'}`}
                aria-hidden="true"
              >
                {done && <Check className="size-3" />}
              </span>
              <span className={done ? 'text-foreground' : ''}>
                <span className="sr-only">{s.label}</span>
                <span aria-hidden="true">{s.label.split(' ')[0]}</span>
              </span>
            </li>
          )
        })}
      </ol>

      <p className="absolute inset-x-5 bottom-6 text-center text-xs text-muted-foreground">Not affiliated with or endorsed by NASA, JPL or Caltech.</p>
    </div>
  )
}
