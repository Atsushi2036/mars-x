import { create } from 'zustand'

export type CameraMode = 'orbit' | 'fpv' | 'chase'

interface CameraStore {
  mode: CameraMode
  setMode: (m: CameraMode) => void
}

/** Single source of truth for the active camera mode. Per-frame state lives in `cameraRig` (mutable, no re-renders). */
export const useCamera = create<CameraStore>((set) => ({
  mode: 'orbit',
  setMode: (mode) => set({ mode }),
}))

/** Mutable per-frame state shared between input widgets (joystick, keyboard) and the camera rig. */
export const cameraRig = {
  /** first-person pose */
  fpv: { x: 0, z: 0, yaw: 0, pitch: 0, eyeY: 0 },
  /** virtual joystick (touch): x = strafe, y = forward, both -1..1 */
  joystick: { x: 0, y: 0 },
  /** touch look delta accumulated since the last frame (radians) */
  lookDelta: { yaw: 0, pitch: 0 },
  sprint: false,
  /** request to teleport the FPV camera / orbit target to a world position (consumed by the rig) */
  jumpTo: null as null | { x: number; z: number },
  pointerLocked: false,
  /** world point the scene is centred on (orbit target / first-person position): drives the sun shadow frustum */
  focus: { x: 0, y: 0, z: 0 },
  /** pending request from `focusBounds`, consumed by the camera rig */
  focusRequest: null as null | WorldBounds,
  /** pending smooth move requested by `flyTo` / `resetNorth` / `zoomBy` / `home`, consumed by the camera rig */
  flyRequest: null as null | FlyRequest,
  /** orbit pose of the opening view, written by the rig once the terrain is known (target on the tile centre) */
  homePose: null as null | FlyPose,
  /** compass heading the camera looks towards, radians (0 = north up). Read-only for widgets; written every frame by the rig */
  azimuth: 0,
  /** camera pose for the minimap cone and the compass (written every frame by the rig) */
  pose: { x: 0, z: 0, yaw: 0, fovDeg: 55, dist: 0 },
  /** continuous zoom while a +/- button is held: -1 in, 1 out, 0 none */
  zoomHold: 0 as -1 | 0 | 1,
  /** return to the opening view (leaves Walk/Follow) */
  home(): void {
    const h = cameraRig.homePose
    if (useCamera.getState().mode !== 'orbit') useCamera.getState().setMode('orbit')
    if (h) flyTo({ ...h }, 1100)
  },
}

/** Pose targets for the orbit camera: all optional, a missing field keeps the current value. */
export interface FlyPose {
  x?: number
  z?: number
  /** distance from the target, metres */
  dist?: number
  /** compass heading, radians (0 = north up) */
  yaw?: number
  /** elevation above the horizon, radians */
  pitch?: number
}
export interface FlyRequest extends FlyPose {
  /** multiply the current distance by this (zoom buttons) */
  distFactor?: number
  /** duration, ms; 0 = instant */
  ms: number
}

const reducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Smoothly moves the camera (orbit: target / distance / heading / tilt; Walk: teleports; Follow: ignored). Reduced motion jumps. */
export function flyTo(p: FlyPose, ms = 900): void {
  for (const v of [p.x, p.z, p.dist, p.yaw, p.pitch]) if (v !== undefined && !Number.isFinite(v)) return
  cameraRig.flyRequest = { ...p, ms: reducedMotion() ? 0 : ms }
}

/** Compass click: heading back to north-up. */
export function resetNorth(): void {
  cameraRig.flyRequest = { yaw: 0, ms: reducedMotion() ? 0 : 350 }
}

/** Zoom by a distance factor (0.75 = in 25 %, 1.33 = out 25 %). */
export function zoomBy(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return
  cameraRig.flyRequest = { distFactor: Math.min(4, Math.max(0.25, factor)), ms: reducedMotion() ? 0 : 200 }
}

/** Live agent pose (rover, astronaut or a replayed episode): what Follow tracks and the minimap draws. Written every frame by the playback driver. */
export const agentLive = { x: 0, z: 0, yaw: 0, ready: false, kind: 'rover' as 'rover' | 'astronaut' | 'run' }

/** Axis-aligned box in world metres: x east, z south (the same axes as the heightfield). */
export interface WorldBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/**
 * Frames a region in the 3D view: switches to the orbit camera, centres it on the box and flies to a distance
 * where the whole box fits (keeping the current compass heading, looking down at about 50 degrees).
 * Ignores boxes with non-finite numbers. Use it to auto-zoom a trajectory: pass the bbox of its world points.
 */
export function focusBounds(b: WorldBounds): void {
  if (![b.minX, b.minZ, b.maxX, b.maxZ].every(Number.isFinite)) return
  cameraRig.focusRequest = {
    minX: Math.min(b.minX, b.maxX),
    maxX: Math.max(b.minX, b.maxX),
    minZ: Math.min(b.minZ, b.maxZ),
    maxZ: Math.max(b.minZ, b.maxZ),
  }
  if (useCamera.getState().mode !== 'orbit') useCamera.getState().setMode('orbit')
}

export const FPV = {
  eyeHeight: 1.7,
  walkSpeed: 3,
  sprintSpeed: 10,
  maxPitch: (80 * Math.PI) / 180,
}
