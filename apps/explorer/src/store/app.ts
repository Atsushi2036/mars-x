import { create } from 'zustand'
import type { Dataset, LoadStage } from '@/core/data/loader'

export type Mode = 'explore' | 'layers' | 'mission' | 'lab' | 'data'
export type LayerId = 'none' | 'slope' | 'hazard' | 'crism'
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
  /** sun direction, compass azimuth (0 = north, clockwise) and elevation above the horizon, degrees */
  sun: { azimuthDeg: number; elevationDeg: number }
  /** atmospheric dust optical depth (tau); drives haze density. Typical 0.3 to 1, dust storms above 3 */
  haze: number
  /** mobile bottom sheet: false = peek (title + first controls), true = expanded */
  sheetExpanded: boolean
  onboardingOpen: boolean
  telemetry: Telemetry
  setMode: (m: Mode) => void
  setSheetExpanded: (e: boolean) => void
  setOnboardingOpen: (o: boolean) => void
  setInspectorOpen: (o: boolean) => void
  setTheme: (t: Theme) => void
  setProgress: (stage: LoadStage, fraction: number) => void
  setDataset: (d: Dataset) => void
  setError: (message: string) => void
  setLayer: (l: LayerId) => void
  setLayerOpacity: (o: number) => void
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
  sun: { azimuthDeg: 250, elevationDeg: 32 },
  haze: 0.5,
  sheetExpanded: false,
  onboardingOpen: false,
  telemetry: { lat: 0, lon: 0, elevation: 0, slopeDeg: 0, x: 0, z: 0, fps: 0 },
  setMode: (mode) => set({ mode, inspectorOpen: true, sheetExpanded: false }),
  setSheetExpanded: (sheetExpanded) => set({ sheetExpanded }),
  setOnboardingOpen: (onboardingOpen) => set({ onboardingOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },
  setProgress: (stage, fraction) => set((s) => ({ progress: { ...s.progress, [stage]: Math.max(s.progress[stage], fraction) } })),
  setDataset: (dataset) => set({ dataset }),
  setError: (error) => set({ status: 'error', error }),
  setLayer: (layer) => set({ layer }),
  setLayerOpacity: (layerOpacity) => set({ layerOpacity }),
  setTelemetry: (telemetry) => set({ telemetry }),
}))

/** Public API for the conditions engine: sets the sun direction (compass azimuth, elevation in degrees). */
export function setSun(azimuthDeg: number, elevationDeg: number) {
  const az = ((azimuthDeg % 360) + 360) % 360
  const el = Math.max(-5, Math.min(90, elevationDeg))
  useApp.setState({ sun: { azimuthDeg: az, elevationDeg: el } })
}

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
