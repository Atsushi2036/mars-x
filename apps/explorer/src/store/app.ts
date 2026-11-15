import { create } from 'zustand'
import type { Dataset, LoadStage } from '@/core/data/loader'

export type Mode = 'explore' | 'layers' | 'mission' | 'lab' | 'data'
export type LayerId = 'none' | 'slope' | 'hazard' | 'crism' | 'slip' | 'illum'
/** who drives the sun: the scenario (sol + local time, Mars24 tables) or a manual override */
export type SunMode = 'scenario' | 'manual'

export interface WaypointInfo {
  sol: number
  site: number
  drive: number
  tiltDeg: number
  pitchDeg: number
  rollDeg: number
  yawDeg: number
  distTotalM: number
  x: number
  z: number
}
export type SheetSnap = 'peek' | 'half' | 'full'
export type Theme = 'dark' | 'light'
export type Status = 'loading' | 'ready' | 'error'

export interface Telemetry {
  lat: number
  lon: number
  elevation: number
  slopeDeg: number
  x: number
  z: number
  fps: number
}

export interface AppState {
  mode: Mode
  /** mobile: whether the inspector bottom sheet is open */
  inspectorOpen: boolean
  theme: Theme
  status: Status
  error: string | null
  progress: Record<LoadStage, number>
  dataset: Dataset | null
  layer: LayerId
  layerOpacity: number
  /** load state of the data behind the active overlay (null for layers that need no download) */
  layerLoad: { id: LayerId; state: 'loading' | 'ready' | 'error'; message?: string } | null
  /** sun direction, compass azimuth (0 = north, clockwise) and elevation above the horizon, degrees */
  sun: { azimuthDeg: number; elevationDeg: number }
  /** atmospheric dust optical depth (tau); drives haze density. Typical 0.3 to 1, dust storms above 3 */
  haze: number
  sunMode: SunMode
  /** draw the real Perseverance traverse and waypoints over the terrain */
  showTraverse: boolean
  /** waypoint the user picked on the 3D view */
  selectedWaypoint: WaypointInfo | null
  /** mobile bottom sheet: false = peek (title + primary action), true = expanded (half or full) */
  sheetExpanded: boolean
  /** mobile sheet snap point: peek 112 px, half 52dvh, full 88dvh. `sheetExpanded` is `snap !== 'peek'` */
  sheetSnap: SheetSnap
  onboardingOpen: boolean
  telemetry: Telemetry
  setMode: (m: Mode) => void
  setSheetExpanded: (e: boolean) => void
  setSheetSnap: (s: SheetSnap) => void
  setOnboardingOpen: (o: boolean) => void
  setInspectorOpen: (o: boolean) => void
  setTheme: (t: Theme) => void
  setSunMode: (m: SunMode) => void
  setShowTraverse: (on: boolean) => void
  setSelectedWaypoint: (w: WaypointInfo | null) => void
  setProgress: (stage: LoadStage, fraction: number) => void
  setDataset: (d: Dataset) => void
  setError: (message: string) => void
  setLayer: (l: LayerId) => void
  setLayerOpacity: (o: number) => void
  setLayerLoad: (l: AppState['layerLoad']) => void
  setTelemetry: (t: Telemetry) => void
}

const THEME_KEY = 'marsx.theme'

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* storage can be blocked */
  }
  return 'dark'
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* ignore */
  }
}

export const useApp = create<AppState>((set) => ({
  mode: 'explore',
  inspectorOpen: false,
  theme: typeof document === 'undefined' ? 'dark' : readTheme(),
  status: 'loading',
  error: null,
  progress: { manifest: 0, elevation: 0, ortho: 0, mesh: 0, ready: 0 },
  dataset: null,
  layer: 'none',
  layerOpacity: 0.85,
  layerLoad: null,
  sun: { azimuthDeg: 250, elevationDeg: 32 },
  haze: 0.5,
  sunMode: 'scenario',
  showTraverse: false,
  selectedWaypoint: null,
  sheetExpanded: false,
  sheetSnap: 'peek',
  onboardingOpen: false,
  telemetry: { lat: 0, lon: 0, elevation: 0, slopeDeg: 0, x: 0, z: 0, fps: 0 },
  // Data & Sources carries the disclaimer and the attributions: its sheet opens at the middle height
  setMode: (mode) => set({ mode, inspectorOpen: true, sheetExpanded: mode === 'data', sheetSnap: mode === 'data' ? 'half' : 'peek' }),
  setSheetExpanded: (sheetExpanded) => set((s) => ({ sheetExpanded, sheetSnap: sheetExpanded ? (s.sheetSnap === 'peek' ? 'half' : s.sheetSnap) : 'peek' })),
  setSheetSnap: (sheetSnap) => set({ sheetSnap, sheetExpanded: sheetSnap !== 'peek' }),
  setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  setSunMode: (sunMode) => set({ sunMode }),
  setShowTraverse: (showTraverse) => set({ showTraverse, ...(showTraverse ? {} : { selectedWaypoint: null }) }),
  setSelectedWaypoint: (selectedWaypoint) => set({ selectedWaypoint }),
  setProgress: (stage, fraction) => set((s) => ({ progress: { ...s.progress, [stage]: Math.max(s.progress[stage], fraction) } })),
  setDataset: (dataset) => set({ dataset }),
  setError: (error) => set({ status: 'error', error }),
  setLayer: (layer) => set({ layer }),
  setLayerOpacity: (layerOpacity) => set({ layerOpacity }),
  setLayerLoad: (layerLoad) => set({ layerLoad }),
  setTelemetry: (telemetry) => set({ telemetry }),
}))

/**
 * Public API for the conditions engine: sets the sun direction (compass azimuth, elevation in degrees).
 * `source` 'scenario' (default) is ignored while the user holds the manual override; 'manual' always applies.
 */
export function setSun(azimuthDeg: number, elevationDeg: number, source: SunMode = 'scenario') {
  if (source === 'scenario' && useApp.getState().sunMode === 'manual') return
  const az = ((azimuthDeg % 360) + 360) % 360
  const el = Math.max(-5, Math.min(90, elevationDeg))
  // the scene reads `sunLive` every frame (no React in the loop); the store, which React panels watch, is refreshed at ~10 Hz
  sunLive.azimuthDeg = az
  sunLive.elevationDeg = el
  const now = performance.now()
  if (now - lastPublish >= 90) {
    lastPublish = now
    clearTimeout(publishTimer)
    useApp.setState({ sun: { azimuthDeg: az, elevationDeg: el } })
  } else {
    clearTimeout(publishTimer)
    publishTimer = setTimeout(() => {
      lastPublish = performance.now()
      useApp.setState({ sun: { azimuthDeg: sunLive.azimuthDeg, elevationDeg: sunLive.elevationDeg } })
    }, 90)
  }
}

/** Live sun angles, always current (mutable; read it in render loops instead of subscribing to the store). */
export const sunLive = { azimuthDeg: 250, elevationDeg: 32 }
let lastPublish = 0
let publishTimer: ReturnType<typeof setTimeout> | undefined

/** Public API for the conditions engine: atmospheric dust optical depth tau (0 = clear). Controls the haze density. */
export function setHaze(tau: number) {
  useApp.setState({ haze: Math.max(0, Math.min(6, Number.isFinite(tau) ? tau : 0.5)) })
}

/** World-space unit vector pointing TOWARDS the sun (x east, y up, z south). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const el = (elevationDeg * Math.PI) / 180
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)]
}
