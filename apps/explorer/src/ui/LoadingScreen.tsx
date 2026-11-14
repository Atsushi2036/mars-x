import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import { useApp } from '@/store/app'
import { LogoMark } from './Logo'

const STAGES = [
  { id: 'manifest', label: 'Dataset manifest', detail: 'Validating the data contract' },
  { id: 'elevation', label: 'Elevation model', detail: '1 m/px heights, decoded on the CPU for camera and rover' },
  { id: 'mesh', label: 'Terrain mesh', detail: 'Chunked levels of detail, built in a worker' },
  { id: 'ortho', label: 'Orbital imagery', detail: 'HiRISE tiles, false-colour tint' },
] as const

/** Full-screen loader with REAL progress per stage. Fades out once the scene reports ready. */
export function LoadingScreen() {
  const progress = useApp((s) => s.progress)
  const ready = progress.ready >= 1
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setGone(true), 450)
    return () => clearTimeout(t)
  }, [ready])
  if (gone) return null

  const overall = STAGES.reduce((a, s) => a + Math.min(1, progress[s.id]), 0) / STAGES.length

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-background p-5 transition-opacity duration-500 ${ready ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <div className="w-full max-w-md space-y-7">
        <div className="flex items-center gap-3">
          <LogoMark className="size-10" />
          <div>
            <h1 className="text-lg font-semibold leading-6 tracking-tight">MARS-X Explorer</h1>
            <p className="text-sm text-muted-foreground">Preparing Jezero crater</p>
          </div>
        </div>

        <ol className="space-y-4">
          {STAGES.map((s) => {
            const f = Math.min(1, progress[s.id])
            const done = f >= 1
            return (
              <li key={s.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{s.label}</span>
                  <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                    {done ? <Check className="size-3.5 text-success" aria-label="Done" /> : `${Math.round(f * 100)}%`}
                  </span>
                </div>
                <Progress value={f * 100} className="h-1" aria-label={s.label} />
                <p className="text-xs text-muted-foreground">{s.detail}</p>
              </li>
            )
          })}
        </ol>

        <div className="space-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <p className="font-mono tabular-nums">{Math.round(overall * 100)}% overall</p>
          <p>Not affiliated with or endorsed by NASA, JPL or Caltech.</p>
        </div>
      </div>
    </div>
  )
}
