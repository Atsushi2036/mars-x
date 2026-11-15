import { useEffect, useRef, useState } from 'react'
import { Check } from '@/ui/icons'
import { useApp } from '@/store/app'
import { LogoWordmark } from './Logo'
import { JezeroContours } from './loading/JezeroContours'
import { Starfield } from './loading/Starfield'
import { marsTexture } from './loading/surface'

const STAGES = [
  { id: 'manifest', label: 'Dataset manifest', status: 'Reading the dataset' },
  { id: 'elevation', label: 'Elevation model', status: 'Loading the elevation model' },
  { id: 'mesh', label: 'Terrain mesh', status: 'Building the terrain' },
  { id: 'ortho', label: 'Orbital imagery', status: 'Loading HiRISE imagery' },
] as const

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Mars as stacked layers: scrolling surface texture, terminator, Jezero isolines, atmosphere. Pure DOM and SVG (no WebGL, no three.js). */
function Globe({ overall, leaving }: { overall: number; leaving: boolean }) {
  const surface = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // paint the surface right after the first frame, so the loader never waits for it
    const t = setTimeout(() => {
      const url = marsTexture()
      if (url && surface.current) surface.current.style.backgroundImage = `url(${url})`
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const zoom = reduced() ? 1 : leaving ? 3.6 : 1
  return (
    <div
      className="absolute inset-[13%] transition-transform duration-[950ms] ease-[cubic-bezier(0.55,0,0.9,0.4)]"
      style={{ transform: `scale(${zoom})` }}
    >
      {/* atmosphere glow */}
      <div className="absolute inset-0 rounded-full" style={{ boxShadow: '0 0 60px 8px rgb(255 128 80 / 0.28), 0 0 140px 30px rgb(255 110 60 / 0.12)' }} />
      <div className="absolute inset-0 overflow-hidden rounded-full bg-[#6b2410]">
        <div
          ref={surface}
          className="globe-scroll absolute inset-y-0 left-0 w-[400%]"
          style={{ backgroundSize: '50% 100%', backgroundRepeat: 'repeat-x', backgroundImage: 'linear-gradient(90deg,#8a2e12,#c1521c 40%,#9a3515 70%,#8a2e12)' }}
        />
        {/* the real crater, zooming in as data arrives */}
        <div
          className="absolute left-1/2 top-1/2 size-[74%] -translate-x-1/2 -translate-y-1/2 transition-transform duration-500 ease-out"
          style={{
            transform: `translate(-50%, -50%) scale(${0.62 + 0.38 * overall})`,
            maskImage: 'radial-gradient(circle, #000 55%, transparent 76%)',
            WebkitMaskImage: 'radial-gradient(circle, #000 55%, transparent 76%)',
          }}
        >
          <JezeroContours progress={overall} />
        </div>
        {/* day and night, limb darkening, a soft highlight */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(112deg, rgb(255 190 140 / 0.14) 0%, transparent 30%, rgb(4 6 12 / 0.5) 66%, rgb(2 3 8 / 0.93) 100%)' }} />
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 40px 6px rgb(0 0 0 / 0.55), inset 8px 8px 24px rgb(255 170 120 / 0.18)' }} />
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: 'inset 0 0 0 1px rgb(255 190 150 / 0.35)' }} />
      </div>
    </div>
  )
}

/** The real progress as an orbit around the planet, with the satellite at its head. */
function OrbitArc({ overall }: { overall: number }) {
  const a = overall * Math.PI * 2 - Math.PI / 2
  const R = 94
  return (
    <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="orbit-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#5CC8E6" />
          <stop offset="1" stopColor="#FFB81F" />
        </linearGradient>
        <filter id="orbit-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <circle cx="100" cy="100" r={R} stroke="#ffffff" strokeOpacity=".1" strokeWidth="1" />
      <g transform="rotate(-90 100 100)">
        <circle cx="100" cy="100" r={R} stroke="url(#orbit-grad)" strokeWidth="5" strokeOpacity=".55" filter="url(#orbit-glow)" pathLength={100} strokeDasharray={`${overall * 100} 100`} style={{ transition: 'stroke-dasharray 400ms var(--ease-out)' }} />
        <circle cx="100" cy="100" r={R} stroke="url(#orbit-grad)" strokeWidth="1.8" strokeLinecap="round" pathLength={100} strokeDasharray={`${overall * 100} 100`} style={{ transition: 'stroke-dasharray 400ms var(--ease-out)' }} />
      </g>
      {overall > 0.005 && overall < 1 && (
        <g transform={`translate(${100 + R * Math.cos(a)} ${100 + R * Math.sin(a)})`}>
          <circle r="5" fill="#FFB81F" opacity=".35" />
          <circle r="2.4" fill="#FFE2A0" />
        </g>
      )}
    </svg>
  )
}

/**
 * Full-screen loader: stars, a slowly turning Mars with the real Jezero isolines drawing themselves, and the real load
 * progress as an orbit. Stays dark in both themes (it is a scene, not a page). On ready the planet zooms in while the screen
 * fades, which hands over to the fly-in. Reduced motion: static planet, no zoom. Errors are drawn by ErrorScreen, not here.
 */
export function LoadingScreen() {
  const progress = useApp((s) => s.progress)
  const ready = progress.ready >= 1
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setGone(true), reduced() ? 250 : 1100)
    return () => clearTimeout(t)
  }, [ready])
  if (gone) return null

  const overall = STAGES.reduce((a, s) => a + Math.min(1, progress[s.id]), 0) / STAGES.length
  const pct = Math.round(overall * 100)
  const current = STAGES.find((s) => progress[s.id] < 1) ?? STAGES[STAGES.length - 1]!
  const status = ready ? 'Ready' : `${current.status} · ${pct}%`

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Loading, ${pct} percent`}
      data-progress={pct}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#05070c] p-5 text-white transition-opacity ${ready ? 'pointer-events-none opacity-0 duration-[850ms] delay-[250ms]' : 'opacity-100 duration-300'}`}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 46%, #101a2c 0%, #070a12 55%, #04060a 100%)' }} />
      <Starfield />

      <header className="absolute inset-x-0 top-[max(1.5rem,6vh)] flex flex-col items-center gap-2">
        <LogoWordmark className="h-7 w-auto text-white md:h-8" />
        <p className="text-xs font-medium tracking-[0.42em] text-[#9aa5b6]">JEZERO TEST BENCH</p>
      </header>

      <div className="relative aspect-square w-[min(82vmin,34rem)]">
        <Globe overall={overall} leaving={ready} />
        <OrbitArc overall={overall} />
      </div>

      <div className="relative mt-4 flex flex-col items-center gap-3">
        <p className="text-base font-medium tabular-nums">{status}</p>
        <ol className="flex items-center gap-4" aria-label="Loading stages">
          {STAGES.map((s) => {
            const done = progress[s.id] >= 1
            return (
              <li key={s.id} className="flex items-center gap-1.5 text-xs text-[#9aa5b6]">
                <span className={`grid size-4 place-items-center rounded-full border ${done ? 'border-[#5fd08a] bg-[#5fd08a]/15 text-[#5fd08a]' : 'border-white/20'}`} aria-hidden="true">
                  {done && <Check className="size-3" />}
                </span>
                <span className={done ? 'text-white' : ''}>
                  <span className="sr-only">{s.label}</span>
                  <span aria-hidden="true">{s.label.split(' ')[0]}</span>
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      <p className="absolute inset-x-5 bottom-6 text-center text-[13px] text-[#9aa5b6]">Not affiliated with or endorsed by NASA, JPL or Caltech.</p>
    </div>
  )
}
