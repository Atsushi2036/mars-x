import { create } from 'zustand'
import type { Episode, TrajArrays } from '@/intelligence'
import { useByo } from '../shared/byo-store'

export interface ReplayState {
  episodeIndex: number | null
  traj: TrajArrays | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  /** current step of the trajectory, 0..steps-1 (fractional while playing) */
  step: number
  playing: boolean
  select: (episode: Episode) => Promise<void>
  setStep: (s: number) => void
  setPlaying: (p: boolean) => void
  clear: () => void
}

let seq = 0

export const useReplay = create<ReplayState>((set) => ({
  episodeIndex: null,
  traj: null,
  status: 'idle',
  error: null,
  step: 0,
  playing: false,
  select: async (episode) => {
    const session = useByo.getState().run.session
    const mine = ++seq
    set({ episodeIndex: episode.index, traj: null, status: 'loading', error: null, step: 0, playing: false })
    if (!session) {
      set({ status: 'error', error: 'No run file is loaded' })
      return
    }
    try {
      const traj = await session.trajectory(episode)
      if (mine !== seq) return
      set({ traj, status: 'ready', step: 0 })
    } catch (e) {
      if (mine !== seq) return
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
  setStep: (step) => set({ step }),
  setPlaying: (playing) => set({ playing }),
  clear: () => {
    seq++
    set({ episodeIndex: null, traj: null, status: 'idle', error: null, step: 0, playing: false })
  },
}))

// closing or replacing the run drops the replay
useByo.subscribe((s, prev) => {
  if (s.run.session !== prev.run.session) useReplay.getState().clear()
})

/** First step whose time is at or after `tS` (binary search; tS is non-decreasing). */
export function stepAtTime(t: ArrayLike<number>, tS: number): number {
  let lo = 0
  let hi = t.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid]! < tS) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const SOL_S = 88775.244

/** "Sol 1 · +3 h 12 min" from elapsed seconds since the episode start. */
export function fmtElapsed(tS: number): string {
  const sol = Math.floor(tS / SOL_S) + 1
  const rest = tS % SOL_S
  const h = Math.floor(rest / 3600)
  const m = Math.floor((rest - h * 3600) / 60)
  return `Sol ${sol} · +${h} h ${String(m).padStart(2, '0')} min`
}

export const EVENT_LABEL: Record<string, string> = {
  rockRevealed: 'Hidden rock found',
  uplink: 'Plan uplinked',
  speAlert: 'Space-weather alert',
  shelterReached: 'Shelter reached',
  stuck: 'Stuck',
  batteryLow: 'Energy low',
  replan: 'Replanned',
}
