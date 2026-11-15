import { useEffect, useRef } from 'react'
import type { EpisodeSample, LearnerSnapshot } from '@/intelligence'
import { useApp } from '@/store/app'
import type { QProblem } from './problem'
import { ACTION_ARROWS, cividis, frameAt, normalizeValues, stepMsFor, type FlashTone, type FloaterTone, type WatchSpeed } from './watch'

export type StageView = 'map' | 'value' | 'policy'
const PX = 6 // canvas pixels per grid cell (drawn at 2x for sharpness)
const NO_ACTION = 255

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

interface Palette {
  planner: string
  agent: string
  fg: string
  gain: string
  loss: string
  hazard: string
  dark: boolean
}
const palette = (dark: boolean): Palette => ({
  planner: token('--planner', '#5cc8e6'),
  agent: token('--agent', '#ffb81f'),
  fg: token('--foreground', '#ffffff'),
  gain: token('--success', '#5fd08a'),
  loss: token('--destructive', '#ff8a80'),
  hazard: token('--destructive', '#ff8a80'),
  dark,
})

const rgb = (c: [number, number, number], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`

/** Static layer: cost shading, optionally the learned value heat map or policy arrows, the A* line and the pins. */
function drawBase(g: CanvasRenderingContext2D, p: QProblem, view: StageView, snap: LearnerSnapshot | null, astar: ArrayLike<number> | null, greedy: ArrayLike<number> | null, pal: Palette) {
  const { rows, cols, cost } = p
  const k = PX * 2
  let max = 1
  for (const v of cost) if (Number.isFinite(v) && v > max) max = v
  const norm = snap && view !== 'map' ? normalizeValues(snap.value, snap.action, NO_ACTION) : null
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const v = cost[i]!
      if (!Number.isFinite(v)) {
        g.fillStyle = pal.dark ? '#05070a' : '#27303c'
      } else if (view === 'value') {
        const t = norm ? norm[i]! : -1
        g.fillStyle = t < 0 ? (pal.dark ? '#141a22' : '#dde3ea') : rgb(cividis(t))
      } else if (view === 'policy') {
        g.fillStyle = pal.dark ? '#10151c' : '#e9edf2'
      } else {
        const t = Math.min(1, (v - 1) / Math.max(0.5, max - 1))
        g.fillStyle = `hsl(215 14% ${pal.dark ? 22 + t * 22 : 94 - t * 28}%)`
      }
      g.fillRect(c * k, r * k, k, k)
    }
  }
  if (view === 'policy' && snap && norm) {
    // one arrow per 2x2 block (the action of its top-left cell): at 48x48 every cell is only ~7 px on screen
    g.lineCap = 'round'
    g.lineWidth = 3
    for (let r = 0; r < rows; r += 2) {
      for (let c = 0; c < cols; c += 2) {
        const i = r * cols + c
        const a = snap.action[i]!
        if (a === NO_ACTION) continue
        const [dr, dc] = ACTION_ARROWS[a]!
        const cx = (c + 1) * k
        const cy = (r + 1) * k
        const len = (k * 1.5) / Math.hypot(dr, dc)
        const ex = cx + (dc * len) / 2
        const ey = cy + (dr * len) / 2
        const sx = cx - (dc * len) / 2
        const sy = cy - (dr * len) / 2
        const t = Math.max(0.15, norm[i]!)
        g.strokeStyle = rgb(cividis(pal.dark ? 0.4 + t * 0.6 : 0.05 + t * 0.5))
        g.fillStyle = g.strokeStyle
        g.beginPath()
        g.moveTo(sx, sy)
        g.lineTo(ex, ey)
        g.stroke()
        const ang = Math.atan2(ey - sy, ex - sx)
        g.beginPath()
        g.moveTo(ex + 2 * Math.cos(ang), ey + 2 * Math.sin(ang))
        g.lineTo(ex - 6 * Math.cos(ang - 0.55), ey - 6 * Math.sin(ang - 0.55))
        g.lineTo(ex - 6 * Math.cos(ang + 0.55), ey - 6 * Math.sin(ang + 0.55))
        g.closePath()
        g.fill()
      }
    }
  }
  const line = (path: ArrayLike<number>, color: string, w: number) => {
    g.strokeStyle = color
    g.lineWidth = w
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.beginPath()
    for (let i = 0; i < path.length; i++) {
      const idx = path[i]!
      const x = (idx % cols) * k + k / 2
      const y = Math.floor(idx / cols) * k + k / 2
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  if (view === 'map' && astar && astar.length > 1) line(astar, pal.planner, 4)
  if (view === 'map' && greedy && greedy.length > 1) line(greedy, pal.agent, 2.5)
  const pin = (idx: number, shape: 'o' | 'd') => {
    const x = (idx % cols) * k + k / 2
    const y = Math.floor(idx / cols) * k + k / 2
    g.fillStyle = pal.fg
    g.strokeStyle = pal.dark ? '#0b0e14' : '#ffffff'
    g.lineWidth = 3
    g.beginPath()
    if (shape === 'o') g.arc(x, y, 8, 0, Math.PI * 2)
    else g.rect(x - 7, y - 7, 14, 14)
    g.fill()
    g.stroke()
  }
  pin(p.start, 'o')
  pin(p.goal, 'd')
}

const toneColor = (pal: Palette, t: FloaterTone | FlashTone) => (t === 'gain' || t === 'goal' ? pal.gain : t === 'loss' || t === 'timeout' ? (t === 'timeout' ? '#8a94a5' : pal.loss) : pal.hazard)

/**
 * The live map: the agent as a dot with a trail, a small +/- floating at every step, a flash at the end of the episode.
 * Draws with requestAnimationFrame straight to the canvas (no React state per frame). With reduced motion the episode
 * is shown at its end state, with no flash or floating numbers.
 */
export function TrainStage({
  problem,
  sample,
  speed,
  view,
  snapshot,
  astarPath,
  greedyPath,
  reducedMotion,
  onPlaybackDone,
  label,
}: {
  problem: QProblem
  sample: EpisodeSample | null
  speed: WatchSpeed
  view: StageView
  snapshot: LearnerSnapshot | null
  astarPath: ArrayLike<number> | null
  greedyPath: ArrayLike<number> | null
  reducedMotion: boolean
  onPlaybackDone: () => void
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const base = useRef<HTMLCanvasElement | null>(null)
  const theme = useApp((s) => s.theme)
  const live = useRef({ sample, speed, reducedMotion, onPlaybackDone })
  useEffect(() => {
    live.current = { sample, speed, reducedMotion, onPlaybackDone }
  })
  const t0 = useRef(0)
  const lastSample = useRef<EpisodeSample | null>(null)
  const finished = useRef(true)
  const wake = useRef<() => void>(() => undefined)

  // static layer
  useEffect(() => {
    const k = PX * 2
    const off = base.current ?? (base.current = document.createElement('canvas'))
    off.width = problem.cols * k
    off.height = problem.rows * k
    const g = off.getContext('2d')
    if (!g) return
    drawBase(g, problem, view, snapshot, astarPath, greedyPath, palette(theme === 'dark'))
    wake.current()
  }, [problem, view, snapshot, astarPath, greedyPath, theme])

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const k = PX * 2
    cv.width = problem.cols * k
    cv.height = problem.rows * k
    const g = cv.getContext('2d')
    if (!g) return
    let raf = 0
    let alive = true
    const pal = () => palette(useApp.getState().theme === 'dark')

    const draw = (now: number) => {
      raf = 0
      if (!alive) return
      if (base.current) g.drawImage(base.current, 0, 0)
      const { sample: s, speed: sp, reducedMotion: rm } = live.current
      if (s !== lastSample.current) {
        lastSample.current = s
        t0.current = now
        finished.current = !s
      }
      if (s) {
        const p = pal()
        const stepMs = rm ? 1 : stepMsFor(sp, s.cells.length)
        const elapsed = rm ? s.cells.length * stepMs + (now - t0.current) : now - t0.current
        const f = frameAt(s, elapsed, stepMs, { endHoldMs: rm ? 1100 : sp === 'slow' ? 1100 : 450, floatMs: sp === 'slow' ? 700 : 350 })
        const xy = (i: number): [number, number] => [(i % problem.cols) * k + k / 2, Math.floor(i / problem.cols) * k + k / 2]
        // flash
        if (f.flash && !rm) {
          g.fillStyle = toneColor(p, f.flash.tone)
          g.globalAlpha = Math.max(0, 0.38 * (1 - f.flash.age))
          g.fillRect(0, 0, cv.width, cv.height)
          g.globalAlpha = 1
        }
        // trail
        if (f.trail.length > 1) {
          g.lineWidth = 3
          g.lineCap = 'round'
          g.lineJoin = 'round'
          for (let i = 1; i < f.trail.length; i++) {
            const [ax, ay] = xy(f.trail[i - 1]!)
            const [bx, by] = xy(f.trail[i]!)
            g.strokeStyle = p.agent
            g.globalAlpha = 0.15 + 0.7 * (i / f.trail.length)
            g.beginPath()
            g.moveTo(ax, ay)
            g.lineTo(bx, by)
            g.stroke()
          }
          g.globalAlpha = 1
        }
        // agent
        const [x, y] = xy(f.cell)
        g.fillStyle = p.agent
        g.strokeStyle = p.dark ? '#0b0e14' : '#ffffff'
        g.lineWidth = 3
        g.beginPath()
        g.arc(x, y, 8.5, 0, Math.PI * 2)
        g.fill()
        g.stroke()
        // floating +/- (and a cross where the move was blocked)
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.font = '600 24px Geist Variable, system-ui, sans-serif'
        if (!rm) {
          for (const fl of f.floaters) {
            const [fx, fy] = xy(fl.cell)
            const col = toneColor(p, fl.tone)
            g.globalAlpha = 1 - fl.age
            if (fl.tone === 'hazard') {
              g.strokeStyle = col
              g.lineWidth = 3.5
              g.beginPath()
              g.moveTo(fx - 7, fy - 7)
              g.lineTo(fx + 7, fy + 7)
              g.moveTo(fx + 7, fy - 7)
              g.lineTo(fx - 7, fy + 7)
              g.stroke()
            }
            // near the top edge the number goes below the cell; it never leaves the canvas sideways
            const stagger = (fl.step % 2) * 24 // consecutive numbers on the same cell sit on two rows
            const ty = fy < 50 ? fy + 26 + fl.age * 40 + stagger : fy - 18 - fl.age * 40 - stagger
            const half = g.measureText(fl.text).width / 2 + 8
            const tx = Math.min(cv.width - half, Math.max(half, fx + (fl.step % 2 ? 18 : -18)))
            g.lineWidth = 5
            g.strokeStyle = p.dark ? 'rgba(8,11,16,0.9)' : 'rgba(255,255,255,0.95)'
            g.strokeText(fl.text, tx, ty)
            g.fillStyle = col
            g.fillText(fl.text, tx, ty)
          }
          g.globalAlpha = 1
        }
        // end-of-episode banner (shown with reduced motion too)
        if (f.banner && f.flash && f.flash.age < 1) {
          const col = toneColor(p, f.flash.tone)
          g.font = '700 34px Geist Variable, system-ui, sans-serif'
          g.lineWidth = 7
          g.strokeStyle = p.dark ? 'rgba(8,11,16,0.92)' : 'rgba(255,255,255,0.95)'
          const by = y < cv.height / 2 ? cv.height - 40 : 40 // opposite side of the agent, so it never hides it
          g.strokeText(f.banner, cv.width / 2, by)
          g.fillStyle = col
          g.fillText(f.banner, cv.width / 2, by)
        }
        const b = f.flash && f.flash.age < 1 ? f.banner ?? '' : ''
        if (cv.dataset.banner !== b) cv.dataset.banner = b // read by the capture harness
        const tones = f.floaters.map((x) => x.tone).join(',')
        if (cv.dataset.tones !== tones) cv.dataset.tones = tones
        if (f.done && !finished.current) {
          finished.current = true
          live.current.onPlaybackDone()
        }
        if (!f.done) raf = requestAnimationFrame(draw)
      }
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw)
    }
    wake.current = kick
    kick()
    return () => {
      alive = false
      if (raf) cancelAnimationFrame(raf)
      wake.current = () => undefined
    }
  }, [problem, view])

  // a new sample restarts the loop
  useEffect(() => {
    wake.current()
  }, [sample])

  return <canvas ref={ref} role="img" aria-label={label} className="mx-auto block aspect-square w-full rounded-xl border border-border max-w-[250px] md:max-w-[300px]" />
}
