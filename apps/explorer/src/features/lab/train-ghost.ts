import { create } from 'zustand'
import type { EpisodeSample } from '@/intelligence'
import type { LearnerCrop } from './ghost-map'
import type { WatchSpeed } from './watch'

/**
 * Bridge between the lab panel and the 3D "ghost rover". The panel publishes each traced episode; the scene layer
 * plays it over the real terrain with the same pacing as the 2D map (same start time, same step duration).
 */
interface GhostState {
  enabled: boolean
  crop: LearnerCrop | null
  sample: EpisodeSample | null
  speed: WatchSpeed
  /** performance.now() when the sample was published */
  startedAt: number
  reducedMotion: boolean
  setEnabled: (on: boolean) => void
  publish: (crop: LearnerCrop, sample: EpisodeSample, speed: WatchSpeed, reducedMotion: boolean) => void
  clear: () => void
}

export const useTrainGhost = create<GhostState>((set) => ({
  enabled: false,
  crop: null,
  sample: null,
  speed: 'fast',
  startedAt: 0,
  reducedMotion: false,
  setEnabled: (enabled) => set(enabled ? { enabled } : { enabled, sample: null }),
  publish: (crop, sample, speed, reducedMotion) => set({ crop, sample, speed, reducedMotion, startedAt: performance.now() }),
  clear: () => set({ sample: null, crop: null }),
}))
