import { useId } from 'react'

/**
 * MARS-X identity. Original artwork (no NASA/JPL marks). The "X" is two routes crossing: the classical planner
 * (cyan, straight) and a learned policy (amber, smooth S-curve). Letters are drawn as strokes so the wordmark reads
 * like a path traced over terrain. Colours are literal on purpose: the identity must not change with the theme
 * (the letters use currentColor so the wordmark flips in light mode).
 */
const CYAN = '#5CC8E6'
const AMBER = '#FFB81F'
const TILE = '#0B0E14'

/** The X by itself (no tile). Use on dark surfaces only, or inside the tile. */
export function LogoSymbol({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none" strokeLinecap="round">
      <path d="M8 8L24 24" stroke={CYAN} strokeWidth="3.4" />
      <path d="M24 8C18 12.5 18 19.5 8 24" stroke={AMBER} strokeWidth="3.4" />
    </svg>
  )
}

/** App mark: the X on a dark tile with faint terrain contours. Safe on any background. */
export function LogoMark({ className }: { className?: string }) {
  const clip = useId()
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" fill="none" strokeLinecap="round">
      <defs>
        <clipPath id={clip}>
          <rect width="32" height="32" rx="8" />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="8" fill={TILE} />
      <g clipPath={`url(#${clip})`} stroke="#1C2530" strokeWidth=".8">
        <path d="M-1 19C5 15 12 20 19 16S28 14 33 17" opacity=".7" />
        <path d="M-1 24C6 20 11 26 18 22S28 20 33 23" />
        <path d="M-1 28C7 25 12 31 19 27S28 26 33 28" />
      </g>
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" stroke="#2A3340" />
      <path d="M8 8L24 24" stroke={CYAN} strokeWidth="3.4" />
      <path d="M24 8C18 12.5 18 19.5 8 24" stroke={AMBER} strokeWidth="3.4" />
    </svg>
  )
}

/** Wordmark MARS + X. Height-driven: give it `h-5`..`h-7`; width follows the 118:28 ratio. */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 118 28" className={className} role="img" aria-label="MARS-X" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <g stroke="currentColor" strokeWidth="3.2" transform="translate(2 4)">
        <path d="M0 20V0l8 11 8-11v20" />
        <path d="M22 20L30 0l8 20M24.8 13.5h10.4" />
        <path d="M44 20V0h9a5.5 5.5 0 0 1 0 11h-9M53 11l7 9" />
        <path d="M80 3.5C78 .5 68 0 66.5 5 65 10 80 10 80 15.5 80 21 68 21 65.5 17" />
      </g>
      <g strokeWidth="3.2" transform="translate(92 4)">
        <path d="M0 0L20 20" stroke={CYAN} />
        <path d="M20 0C12.5 5.6 12.5 14.4 0 20" stroke={AMBER} />
      </g>
    </svg>
  )
}
