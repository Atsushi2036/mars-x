import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { cameraRig, useCamera } from '@/store/camera'
import { useMission } from '@/store/mission'
import { usePlayback } from '@/store/playback'
import { useRover } from '@/store/rover'
import { currentWatchTarget } from '@/store/watch'
import { House, Layers } from '@/ui/icons'
import { CameraDock } from './CameraDock'
import { ControlHints } from './ControlHints'
import { HelpOverlay } from './HelpOverlay'
import { Minimap, miniPerf } from './Minimap'
import { openHelp } from './store'
import { WatchBar, WatchButton } from './WatchBar'
import { selectPicking, useWizard } from '../wizard/store'
import { useImmersive } from '../wizard/immersive'
import { ZoomCluster } from './ZoomCluster'

const DESKTOP = '(min-width: 768px)'
function useDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DESKTOP)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  )
}

const isField = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Keys that are not camera moves: Space (Watch), H or ? (help), Esc (leave Watch / Walk / Follow). */
function useNavKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return
      const dialog = document.querySelector('[role="dialog"]')
      const pb = usePlayback.getState()
      if (e.key === 'Escape') {
        if (dialog) return
        if (pb.source) pb.exit()
        else if (useCamera.getState().mode !== 'orbit') useCamera.getState().setMode('orbit')
      } else if (e.code === 'Space') {
        const t = e.target as HTMLElement | null
        if (!pb.source || dialog || t?.closest('[data-playpause],[role="slider"],a')) return
        e.preventDefault()
        pb.toggle()
      } else if (!dialog && (e.code === 'KeyH' || e.key === '?')) openHelp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Ring that marks where a double-click / double-tap is flying to (Web Animations API, no React renders). */
function Ripple() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const on = (e: Event) => {
      const el = ref.current
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail
      if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      el.style.left = `${x - 20}px`
      el.style.top = `${y - 20}px`
      el.animate([{ transform: 'scale(.3)', opacity: 0.95 }, { transform: 'scale(1.5)', opacity: 0 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' })
    }
    window.addEventListener('marsx:ripple', on)
    return () => window.removeEventListener('marsx:ripple', on)
  }, [])
  return <div ref={ref} aria-hidden="true" className="pointer-events-none fixed z-30 size-10 rounded-full border-2 border-white opacity-0 shadow-[0_0_0_1.5px_rgba(11,14,20,.6)]" />
}

function FollowNeedsRoute() {
  const mode = useCamera((s) => s.mode)
  const watching = usePlayback((s) => s.source !== null)
  const appMode = useApp((s) => s.mode)
  useMission((s) => s.outcomes)
  const driving = useRover((s) => s.status) === 'driving'
  if (mode !== 'chase' || watching || driving || currentWatchTarget(appMode)) return null
  return (
    <div className="glass pointer-events-auto flex items-center gap-2 rounded-full py-1 pl-3.5 pr-1 text-sm">
      <span>Plan a route first</span>
      <Button size="sm" className="h-9 rounded-full px-3 text-sm" onClick={() => useApp.getState().setMode('mission')}>
        Plan a route
      </Button>
    </div>
  )
}

/**
 * Map widgets over the 3D view (z 10, under the shell chrome): Layers + Home (top left), minimap (bottom left), zoom cluster and
 * compass (right, hugging the inspector), and the bottom-centre stack: hint, Watch button, camera dock or playback bar.
 * Everything is positioned from the shell's `--cover-*` variables, so it never overlaps the topbar, inspector, sheet or telemetry.
 */
export default function NavLayer() {
  const journey = useImmersive()
  const picking = useWizard(selectPicking)
  const desktop = useDesktop()
  const mode = useCamera((s) => s.mode)
  const watching = usePlayback((s) => s.source !== null)
  const ready = useApp((s) => s.progress.ready >= 1)
  useNavKeys()
  useEffect(() => {
    // test hook for Playwright: live camera pose, camera mode and the playback store
    const w = window as unknown as { __marsx?: Record<string, unknown> }
    if (w.__marsx) w.__marsx.nav = { rig: cameraRig, camera: useCamera, playback: usePlayback, miniPerf }
  }, [ready])
  if (!ready) return null
  const base = 'calc(var(--cover-bottom) + 12px)'
  // on phones the playback bar is full width and taller than the dock: lift the side widgets above it
  const lift = watching && !desktop ? 'calc(var(--cover-bottom) + 12px + 8.5rem)' : base
  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-nav-layer>
      {!journey && !picking && (
      <div className="absolute left-3 flex items-center gap-2" style={{ top: 'calc(var(--cover-top) + 12px)' }}>
        <button type="button" className="glass pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-95" onClick={() => useApp.getState().setMode("layers")}>
          <Layers className="size-5" strokeWidth={1.75} aria-hidden="true" />
          Layers
        </button>
        <button
          type="button"
          aria-label="Home view (R)"
          title="Home view (R)"
          onClick={() => cameraRig.home()}
          className="glass pointer-events-auto grid size-11 place-items-center rounded-full text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:scale-95"
        >
          <House className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      )}

      {!journey && (desktop || mode !== 'fpv') && (
        <div className="absolute left-3" style={{ bottom: lift }}>
          <Minimap compact={!desktop} />
        </div>
      )}

      {!journey && (
        <div className="absolute" style={{ right: 'calc(var(--cover-right) + 16px)', bottom: lift }}>
          <ZoomCluster />
        </div>
      )}

      <div className="absolute flex -translate-x-1/2 flex-col items-center gap-2" style={{ left: 'calc((100% - var(--cover-right)) / 2)', bottom: base }}>
        {!journey && <ControlHints />}
        <FollowNeedsRoute />
        {!watching && !picking && <WatchButton />}
        {watching ? <WatchBar /> : !journey && <CameraDock onHelp={openHelp} />}
      </div>
      <Ripple />
      <HelpOverlay />
    </div>
  )
}
