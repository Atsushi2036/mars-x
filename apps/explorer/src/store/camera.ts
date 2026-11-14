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
}

export const FPV = {
  eyeHeight: 1.7,
  walkSpeed: 3,
  sprintSpeed: 10,
  maxPitch: (80 * Math.PI) / 180,
}
