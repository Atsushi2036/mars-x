import { create } from 'zustand'
import { useCamera, type CameraMode } from './camera'

/**
 * Watch playback shared by Mission routes and replayed episodes: the "Watch" button starts it, the Watch bar drives it,
 * `PlaybackDriver` (src/scene) turns it into motion. `t` and `duration` share a unit chosen by the source:
 * drive seconds for a route, trajectory steps for a run (the bar shows `label(t)`).
 */
export type PlaybackSource = 'route' | 'run'
export const SPEEDS = [0.5, 1, 2, 4] as const
export type PlaybackSpeed = (typeof SPEEDS)[number]
export type EventKind = 'rock' | 'spe' | 'low-energy' | 'stuck' | 'end'

export interface PlaybackEvent {
  t: number
  kind: EventKind
  label: string
}

export interface BeginOptions {
  source: PlaybackSource
  duration: number
  label: (t: number) => string
  events?: PlaybackEvent[]
  /** what the bar calls the thing being watched ("route", "run") */
  noun?: string
  /** mission seconds per second of playback at 1x (a rover is shown ~36x faster than it drives); default 1 */
  timeScale?: number
  /** driven live by an AI policy rather than the A* plan */
  ai?: boolean
}

interface PlaybackState {
  source: PlaybackSource | null
  playing: boolean
  speed: PlaybackSpeed
  t: number
  duration: number
  /** how much faster than real time the 1x playback is (1 = real time) */
  timeScale: number
  /** driven live by an AI policy rather than the A* plan */
  ai: boolean
  events: PlaybackEvent[]
  label: (t: number) => string
  /** camera to return to on Exit */
  prevMode: CameraMode
  /** bumped on every seek; the driver re-positions the agent when it changes */
  seekNonce: number
  begin: (o: BeginOptions) => void
  toggle: () => void
  play: () => void
  pause: () => void
  setSpeed: (s: PlaybackSpeed) => void
  seek: (t: number) => void
  restart: () => void
  /** driver: report progress without bumping `seekNonce` */
  tick: (t: number) => void
  finish: () => void
  exit: () => void
}

/** Mutable flags the scene reads every frame (no re-renders): the rover pauses and runs fast through these. */
export const playbackLive = { paused: false, rate: 1, travelled: 0 }

const IDLE = { source: null, playing: false, speed: 1 as PlaybackSpeed, t: 0, duration: 0, timeScale: 1, ai: false, events: [] as PlaybackEvent[], label: (t: number) => String(t) }

const sync = (s: Pick<PlaybackState, 'playing' | 'speed'>) => {
  playbackLive.paused = !s.playing
  playbackLive.rate = s.speed
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  ...IDLE,
  prevMode: 'orbit',
  seekNonce: 0,
  begin: (o) => {
    const cur = useCamera.getState().mode
    const prev = get().source ? get().prevMode : cur === 'chase' ? 'orbit' : cur
    set({ ...IDLE, source: o.source, playing: true, duration: Math.max(0, o.duration), timeScale: Math.max(1, o.timeScale ?? 1), ai: !!o.ai, events: o.events ?? [], label: o.label, prevMode: prev, seekNonce: get().seekNonce + 1 })
    sync({ playing: true, speed: 1 })
    useCamera.getState().setMode('chase')
  },
  toggle: () => {
    const s = get()
    if (!s.source) return
    if (!s.playing) get().play()
    else get().pause()
  },
  play: () => {
    const s = get()
    if (!s.source) return
    if (s.t >= s.duration) set({ t: 0, seekNonce: s.seekNonce + 1 })
    set({ playing: true })
    sync({ playing: true, speed: get().speed })
  },
  pause: () => {
    if (!get().source) return
    set({ playing: false })
    sync({ playing: false, speed: get().speed })
  },
  setSpeed: (speed) => {
    if (!SPEEDS.includes(speed)) return
    set({ speed })
    sync({ playing: get().playing, speed })
  },
  seek: (t) => {
    const s = get()
    if (!s.source) return
    set({ t: Math.min(s.duration, Math.max(0, t)), seekNonce: s.seekNonce + 1 })
  },
  restart: () => {
    get().seek(0)
    get().play()
  },
  tick: (t) => set({ t: Math.min(get().duration, Math.max(0, t)) }),
  finish: () => {
    set({ t: get().duration, playing: false })
    sync({ playing: false, speed: get().speed })
  },
  exit: () => {
    const s = get()
    const had = s.source !== null
    set({ ...IDLE })
    sync({ playing: true, speed: 1 })
    if (had) useCamera.getState().setMode(s.prevMode)
  },
}))

/** m:ss (drive time of a route). */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Mission time for people: "42 s", "12 min", "2 h 50 min". */
export function fmtMission(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/** Replay event type to the marker the bar draws (rock, space weather, low energy, stuck, end of the run); null = not a marker. */
export function eventKind(type: string): EventKind | null {
  switch (type) {
    case 'rockRevealed':
      return 'rock'
    case 'speAlert':
      return 'spe'
    case 'batteryLow':
      return 'low-energy'
    case 'stuck':
      return 'stuck'
    case 'shelterReached':
      return 'end'
    default:
      return null
  }
}

type XZ = { x: number; z: number }

export function pathLength(path: readonly XZ[]): number {
  let d = 0
  for (let i = 1; i < path.length; i++) d += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z)
  return d
}

/** Point at distance `d` along the path plus the waypoints still ahead of it (always at least the last one). */
export function pointAlong(path: readonly XZ[], d: number): XZ & { rest: XZ[] } {
  let left = Math.max(0, d)
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    if (left <= seg && seg > 0) {
      const f = left / seg
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, rest: path.slice(i).map((p) => ({ x: p.x, z: p.z })) }
    }
    left -= seg
  }
  const last = path[path.length - 1]!
  return { x: last.x, z: last.z, rest: [{ x: last.x, z: last.z }] }
}
