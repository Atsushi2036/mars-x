import { create } from 'zustand'
import { DAY_SPEEDS, type DaySpeed } from './day-clock'

interface DayStore {
  playing: boolean
  speed: DaySpeed
  secondsPerSol: number
  setPlaying: (p: boolean) => void
  setSpeed: (s: DaySpeed) => void
}

/** Day animation state: the scene's ConditionsDriver advances the scenario's local time while `playing`. */
export const useDay = create<DayStore>((set) => ({
  playing: false,
  speed: 'normal',
  secondsPerSol: DAY_SPEEDS.normal,
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed, secondsPerSol: DAY_SPEEDS[speed] }),
}))
