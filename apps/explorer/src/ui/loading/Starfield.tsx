import { useEffect, useRef } from 'react'

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Two layers of seeded stars (far, near). Computed once at module load; ~150 tiny circles. */
const LAYERS = [0, 1].map((layer) => {
  const r = rng(91 + layer * 7)
  return Array.from({ length: layer === 0 ? 110 : 45 }, () => ({
    x: r() * 100,
    y: r() * 100,
    r: layer === 0 ? 0.08 + r() * 0.12 : 0.14 + r() * 0.2,
    o: 0.25 + r() * 0.75,
    warm: r() > 0.82,
  }))
})

/** Star background with a very subtle pointer parallax (set through CSS variables, no React state). */
export function Starfield() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--px', String((e.clientX / window.innerWidth - 0.5) * 2))
        el.style.setProperty('--py', String((e.clientY / window.innerHeight - 0.5) * 2))
      })
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])
  return (
    <div ref={root} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ ['--px' as string]: 0, ['--py' as string]: 0 }}>
      {LAYERS.map((stars, i) => (
        <svg
          key={i}
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
          className="absolute -inset-[4%] size-[108%] transition-transform duration-500 ease-out"
          style={{ transform: `translate(calc(var(--px) * ${i === 0 ? -5 : -12}px), calc(var(--py) * ${i === 0 ? -5 : -12}px))` }}
        >
          {stars.map((s, k) => (
            <circle key={k} cx={s.x} cy={s.y} r={s.r} fill={s.warm ? '#ffd9b8' : '#dbe7ff'} opacity={s.o} />
          ))}
        </svg>
      ))}
    </div>
  )
}
