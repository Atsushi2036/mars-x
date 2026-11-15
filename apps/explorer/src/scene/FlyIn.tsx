import { useEffect, useRef, useState } from 'react'
import { LogoWordmark } from '@/ui/Logo'
import { useApp } from '@/store/app'
import { cameraRig, flyTo } from '@/store/camera'

const KEY = 'marsx.flyin'
const DURATION_MS = 3400
const START = { dist: 1840, pitch: (78 * Math.PI) / 180, yaw: (-35 * Math.PI) / 180 }

function shouldPlay(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.get('intro') === '1') return true // explicit opt-in (tests, captures)
    if (q.get('intro') === '0' || q.has('tour')) return false
    if (navigator.webdriver) return false // automated browsers start at the final pose
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    return sessionStorage.getItem(KEY) !== '1'
  } catch {
    return false
  }
}

/**
 * Cinematic opening: when the scene is ready the camera starts high over the tile and descends to the home pose (3.4 s),
 * while a title card fades in and out. Any pointer, key or wheel input ends it instantly at the home pose.
 * Once per session; skipped for reduced motion, automation and the guided tour. The camera is driven through `flyTo`.
 */
export function FlyIn() {
  const ready = useApp((s) => s.progress.ready >= 1)
  const [phase, setPhase] = useState<'idle' | 'playing'>('idle')
  const started = useRef(false)

  useEffect(() => {
    if (!ready || started.current) return
    started.current = true
    if (!shouldPlay()) return
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* storage can be blocked */
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const begin = (tries: number) => {
      if (cancelled) return
      const home = cameraRig.homePose
      if (!home) {
        // the rig writes the home pose on its first frames
        if (tries < 60) timer = setTimeout(() => begin(tries + 1), 100)
        return
      }
      flyTo({ x: home.x, z: home.z, ...START }, 0)
      // the rig consumes one request per frame: wait until the jump has landed, then descend
      const descend = (n: number) => {
        if (cancelled) return
        if (cameraRig.flyRequest !== null && n < 80) {
          timer = setTimeout(() => descend(n + 1), 50)
          return
        }
        setPhase('playing')
        flyTo({ ...home }, DURATION_MS)
        timer = setTimeout(() => setPhase('idle'), DURATION_MS + 200)
      }
      timer = setTimeout(() => descend(0), 50)
    }
    begin(0)
    const skip = () => {
      cancelled = true
      clearTimeout(timer)
      const home = cameraRig.homePose
      if (home) flyTo({ ...home }, 0)
      setPhase('idle')
    }
    const opts = { once: true, capture: true } as const
    window.addEventListener('pointerdown', skip, opts)
    window.addEventListener('keydown', skip, opts)
    window.addEventListener('wheel', skip, opts)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('pointerdown', skip, opts)
      window.removeEventListener('keydown', skip, opts)
      window.removeEventListener('wheel', skip, opts)
    }
  }, [ready])

  if (phase !== 'playing') return null
  return (
    <div
      aria-hidden="true"
      data-testid="flyin-title"
      className="pointer-events-none absolute inset-0 z-30 grid place-items-center"
    >
      <div className="flyin-title flex flex-col items-center gap-3 rounded-3xl px-8 py-6 text-center text-white">
        <LogoWordmark className="h-8 w-auto text-white md:h-10" />
        <p className="text-base font-medium tracking-wide text-white/90">Jezero crater · 18.46°N 77.39°E</p>
      </div>
    </div>
  )
}
