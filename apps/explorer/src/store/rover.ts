import { create } from 'zustand'
import type { Waypoint } from '@/core/rover/path-follower'

export type RoverStatus = 'idle' | 'driving' | 'arrived'

interface RoverStore {
  status: RoverStatus
  speed: number
  /** requested route; the scene creates a PathFollower when this changes */
  route: { id: number; waypoints: Waypoint[]; speed: number; loop: boolean } | null
  /** drive a list of waypoints (world metres) at `speed` m/s */
  followPath: (waypoints: Waypoint[], speed?: number, loop?: boolean) => void
  stop: () => void
  setStatus: (s: RoverStatus) => void
}

let routeId = 0

export const useRover = create<RoverStore>((set) => ({
  status: 'idle',
  speed: 0,
  route: null,
  followPath: (waypoints, speed = 1.5, loop = false) =>
    set({ route: { id: ++routeId, waypoints, speed, loop }, status: 'driving' }),
  stop: () => set({ route: null, status: 'idle' }),
  setStatus: (status) => set({ status }),
}))

/** Mutable live rover pose (written by the scene every frame, read by cameras/telemetry). */
export const roverLive = { x: 0, z: 0, yaw: 0, ready: false }
