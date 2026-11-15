import { useEffect, useRef } from 'react'
import { useApp } from '@/store/app'
import type { QProblem } from './problem'

const PX = 6 // canvas pixels per grid cell (drawn at 2x for sharpness)

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** The learning grid: cost as brightness, blocked cells hatched, A* path in blue, the learner's greedy path in orange. */
export function PathMap({ problem, astarPath, greedyPath }: { problem: QProblem; astarPath: ArrayLike<number> | null; greedyPath: ArrayLike<number> | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useApp((s) => s.theme)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const { rows, cols, cost } = problem
    const k = PX * 2
    cv.width = cols * k
    cv.height = rows * k
    const g = cv.getContext('2d')
    if (!g) return
    const dark = theme === 'dark'
    const c1 = token('--chart-1', '#5cc8e6')
    const c2 = token('--chart-2', '#f08a4b')
    const brand = token('--brand', '#ffb81f')
    let max = 1
    for (const v of cost) if (Number.isFinite(v) && v > max) max = v
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = cost[r * cols + c]!
        if (!Number.isFinite(v)) {
          g.fillStyle = dark ? '#05070a' : '#27303c'
        } else {
          const t = Math.min(1, (v - 1) / Math.max(0.5, max - 1))
          const l = dark ? 22 + t * 22 : 94 - t * 28
          g.fillStyle = `hsl(215 14% ${l}%)`
        }
        g.fillRect(c * k, r * k, k, k)
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
    if (astarPath && astarPath.length > 1) line(astarPath, c1, 5)
    if (greedyPath && greedyPath.length > 1) line(greedyPath, c2, 3)
    const dot = (idx: number, shape: 'o' | 'd') => {
      const x = (idx % cols) * k + k / 2
      const y = Math.floor(idx / cols) * k + k / 2
      g.fillStyle = brand
      g.strokeStyle = dark ? '#0b0e14' : '#ffffff'
      g.lineWidth = 3
      g.beginPath()
      if (shape === 'o') g.arc(x, y, 8, 0, Math.PI * 2)
      else g.rect(x - 7, y - 7, 14, 14)
      g.fill()
      g.stroke()
    }
    dot(problem.start, 'o')
    dot(problem.goal, 'd')
  }, [problem, astarPath, greedyPath, theme])

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={`Learning grid ${problem.cols} by ${problem.rows} cells of ${problem.cellM} metres. Blue is the A* path, orange is the path the learned policy follows.`}
      className="block aspect-square w-full rounded-md border border-border"
    />
  )
}
