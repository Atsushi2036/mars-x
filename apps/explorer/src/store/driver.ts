import { create } from 'zustand'
import type { CatalogEntry } from '@/features/shared/model-catalog'

/**
 * Who drives the agent in Watch. `astar` replays the classic A* plan; `reference` runs the PPO we trained (policy/1 ONNX) live in
 * env-lite; `user` runs the model dropped in Test your AI. Set it from any UI with `setDriver(kind)`; read it with `useDriver`.
 * Flip DRIVER_ENABLED to false to hide the AI options everywhere (the A* Watch is unaffected).
 */
export const DRIVER_ENABLED = true

/** 'astar' | 'user' (the ONNX the user dropped) | 'reference' (built-in fallback when there is no catalog) | `catalog:<id>` (a catalog model) */
export type DriverKind = 'astar' | 'user' | 'reference' | `catalog:${string}`
export type AiDriverKind = Exclude<DriverKind, 'astar'>

export const catalogId = (k: DriverKind): string | null => (k.startsWith('catalog:') ? k.slice(8) : null)

/** start/goal distance band the reference policy was trained on (policy card: 40-700 m) */
export const TRAINED_RANGE_M = [40, 700] as const

export interface DriveSummary {
  kind: AiDriverKind
  outcome: 'success' | 'collision' | 'battery' | 'spe_violation' | 'timeout' | 'error' | 'aborted'
  steps: number
  /** metres the AI covered (env-lite path length) */
  pathM: number
  /** length of the A* route for the same start and goal */
  astarM: number
  blockedAttempts: number
  error?: string
}

export interface DriverState {
  kind: DriverKind
  /** loading the model, driving live, or finished (summary set) */
  phase: 'idle' | 'loading' | 'driving' | 'done'
  /** a one-line message for the UI (fallback to A*, long-route warning) */
  notice: string | null
  summary: DriveSummary | null
  /** whether the reference model is published with this build (probed once) */
  referenceStatus: 'unknown' | 'ok' | 'missing'
  /** models of the build catalog (set by the picker from useModelCatalog) */
  catalog: CatalogEntry[]
}

export const useDriver = create<DriverState>(() => ({ kind: 'astar', phase: 'idle', notice: null, summary: null, referenceStatus: 'unknown', catalog: [] }))

export function setDriver(kind: DriverKind): void {
  if (!DRIVER_ENABLED && kind !== 'astar') return
  useDriver.setState({ kind, notice: null, summary: null })
}

/** Honest one-line label of what drives the agent, for the chip and the bar. */
export function driverLabel(kind: DriverKind, modelName: string | null, catalog: readonly CatalogEntry[] = []): string {
  if (kind === 'reference') return 'Reference AI · PPO 0.2.0 · trained offline, does not pass v0.1'
  if (kind === 'user') return `Your model · ${modelName ?? 'ONNX policy'}`
  const e = catalog.find((m) => m.id === catalogId(kind))
  if (e) return `${e.name} ${e.version} · ${e.kind === 'reference' ? 'trained offline, ' : 'example model, '}${e.passesL1 ? 'passes v0.1 L1' : 'does not pass v0.1'}`
  return 'Driven by: A* planner (classic, not AI)'
}

/** What a finished drive says, in one line. */
export function outcomeText(o: DriveSummary['outcome']): string {
  switch (o) {
    case 'success':
      return 'Reached the goal'
    case 'collision':
      return 'Hit an obstacle'
    case 'battery':
      return 'Ran out of battery'
    case 'spe_violation':
      return 'Missed the shelter window'
    case 'timeout':
      return 'Ran out of steps'
    case 'aborted':
      return 'Stopped'
    default:
      return 'The model failed'
  }
}

/** Warning for a route outside the distance band the reference policy was trained on; null when inside. */
export function trainedRangeWarning(straightM: number): string | null {
  if (straightM > TRAINED_RANGE_M[1]) return `This route is longer than the ${TRAINED_RANGE_M[0]}-${TRAINED_RANGE_M[1]} m the policy was trained on.`
  if (straightM < TRAINED_RANGE_M[0]) return `This route is shorter than the ${TRAINED_RANGE_M[0]}-${TRAINED_RANGE_M[1]} m the policy was trained on.`
  return null
}
