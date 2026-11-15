import { useId } from 'react'

/**
 * MARS-X identity. Original artwork (no NASA/JPL marks), inline SVG only.
 * A stylised Mars (oxide disc, day/night terminator, thin atmosphere rim) with two routes crossing over it: the classical
 * planner (cyan, straight) and a learned policy (amber, curved). The routes ARE the "X" of the name.
 * Colours are literal on purpose: the identity must not change with the theme (the wordmark letters use currentColor).
 */
const CYAN = '#5CC8E6'
const AMBER = '#FFB81F'

/** Gradients of the planet. Ids are unique per instance (a hidden <svg> that owns a gradient breaks references to it). */
function PlanetDefs({ id }: { id: string }) {
  return (
    <defs>
      <radialGradient id={`${id}-body`} cx=".34" cy=".28" r=".92">
        <stop offset="0" stopColor="#f28c4e" />
        <stop offset=".36" stopColor="#c8501a" />
        <stop offset=".7" stopColor="#8a2b0f" />
        <stop offset="1" stopColor="#3a1007" />
      </radialGradient>
      <linearGradient id={`${id}-night`} x1=".2" y1=".1" x2=".95" y2=".95">
        <stop offset=".24" stopColor="#05070c" stopOpacity="0" />
        <stop offset=".6" stopColor="#05070c" stopOpacity=".6" />
        <stop offset="1" stopColor="#05070c" stopOpacity=".95" />
      </linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffd2a8" stopOpacity=".95" />
        <stop offset=".55" stopColor="#ff9a62" stopOpacity=".5" />
        <stop offset="1" stopColor="#ff7a45" stopOpacity=".05" />
      </linearGradient>
      <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#18202c" />
        <stop offset="1" stopColor="#090c12" />
      </linearGradient>
      <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".22" />
        <stop offset=".5" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
  )
}

/** The planet disc with terminator and atmosphere, centred at (cx, cy). */
function Planet({ id, cx, cy, r }: { id: string; cx: number; cy: number; r: number }) {
  const k = r / 11.2
  return (
    <g transform={`translate(${cx} ${cy}) scale(${k}) translate(-16 -16)`}>
      <circle cx="16" cy="16" r="12.7" fill="none" stroke="#ff8a55" strokeOpacity=".16" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="11.2" fill={`url(#${id}-body)`} />
      {/* a few dark plains and craters: texture that survives at 32 px and quietly disappears at 16 */}
      <g fill="#4a1708" opacity=".32">
        <ellipse cx="11.5" cy="13" rx="3.3" ry="1.8" transform="rotate(-24 11.5 13)" />
        <ellipse cx="19.5" cy="21.5" rx="2.6" ry="1.4" transform="rotate(18 19.5 21.5)" />
        <circle cx="21" cy="11.5" r="1.1" />
      </g>
      <circle cx="16" cy="16" r="11.2" fill={`url(#${id}-night)`} />
      <circle cx="16" cy="16" r="11.2" fill="none" stroke={`url(#${id}-rim)`} strokeWidth=".8" />
    </g>
  )
}

/** The two routes. A dark halo under each keeps them readable on the oxide disc. */
function Routes({ w = 2.8, halo = 1.6, x0 = 8.5, x1 = 23.5 }: { w?: number; halo?: number; x0?: number; x1?: number }) {
  const s = x1 - x0
  const straight = `M${x0} ${x0}L${x1} ${x1}`
  const curve = `M${x1} ${x0}C${x0 + s * 0.62} ${x0 + s * 0.28} ${x0 + s * 0.38} ${x0 + s * 0.72} ${x0} ${x1}`
  return (
    <g fill="none" strokeLinecap="round">
      <path d={straight} stroke="#06080d" strokeOpacity=".5" strokeWidth={w + halo} />
      <path d={curve} stroke="#06080d" strokeOpacity=".5" strokeWidth={w + halo} />
      <path d={straight} stroke={CYAN} strokeWidth={w} />
      <path d={curve} stroke={AMBER} strokeWidth={w} />
    </g>
  )
}

/** The planet and the X by itself (no tile). Use on dark surfaces. */
export function LogoSymbol({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <PlanetDefs id={id} />
      <Planet id={id} cx={16} cy={16} r={12.4} />
      <Routes w={3} x0={6.5} x1={25.5} />
    </svg>
  )
}

/** App mark: Mars and the crossing routes on a dark tile with a soft highlight. Safe on any background. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <PlanetDefs id={id} />
      <rect width="32" height="32" rx="8" fill={`url(#${id}-tile)`} />
      <rect width="32" height="32" rx="8" fill={`url(#${id}-shine)`} />
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="none" stroke="#2f3a4a" />
      <Planet id={id} cx={16} cy={16} r={11.2} />
      <Routes />
    </svg>
  )
}

/**
 * Wordmark MARS + X. Geometric strokes with wide tracking; the X is the two routes over a small Mars.
 * Height-driven: give it `h-5`..`h-7`; width follows the 134:28 ratio. Letters use currentColor.
 */
export function LogoWordmark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 134 28" className={className} role="img" aria-label="MARS-X" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <PlanetDefs id={id} />
      <g stroke="currentColor" strokeWidth="2.7" transform="translate(2 4)">
        <path d="M0 20V0l8 11 8-11v20" />
        <path d="M26 20L34 0l8 20M28.8 13.5h10.4" />
        <path d="M52 20V0h9a5.5 5.5 0 0 1 0 11h-9M61 11l7 9" />
        <path d="M92 3.5C90 .5 80 0 78.5 5 77 10 92 10 92 15.5 92 21 80 21 77.5 17" />
      </g>
      <g transform="translate(103 4)">
        <Planet id={id} cx={10} cy={10} r={8.6} />
        <Routes w={2.6} halo={1.6} x0={1.5} x1={18.5} />
      </g>
    </svg>
  )
}
