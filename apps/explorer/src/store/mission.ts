import { create } from 'zustand'
import type { PlanLayers } from '@/core/mission/plan-layers'
import { pathStats, pathToWorld, worldToCell, type PathStats, type XZ } from '@/core/mission/geometry'
import type { Dataset } from '@/core/data/loader'

export type MissionProfile = 'astronaut' | 'rover-rtg' | 'rover-solar'

export type ProfileOutcome =
  | { status: 'ok'; path: XZ[]; stats: PathStats; expanded: number; ms: number }
  | { status: 'no-route'; message: string; ms: number; requiredSlopeDeg: number | null }
  | { status: 'error'; message: string }

export interface MissionState {
  layersStatus: 'idle' | 'loading' | 'ready' | 'error'
  layersError: string | null
  layers: PlanLayers | null
  /** which endpoint the next terrain click sets */
  placing: 'origin' | 'destination'
  origin: XZ | null
  destination: XZ | null
  planning: boolean
  outcomes: Partial<Record<MissionProfile, ProfileOutcome>>
  profile: MissionProfile
  setProfile: (p: MissionProfile) => void
  setPlacing: (p: 'origin' | 'destination') => void
  ensureLayers: (ds: Dataset) => Promise<void>
  place: (ds: Dataset, p: XZ) => void
  clear: () => void
}

let pool: import('@/intelligence/nav/planner-pool').PlannerPool | null = null
let poolLayers: PlanLayers | null = null
let seq = 0

async function getPool(layers: PlanLayers) {
  if (pool && poolLayers === layers) return pool
  const { PlannerPool } = await import('@/intelligence/nav/planner-pool')
  pool?.dispose()
  pool = new PlannerPool()
  await pool.setLayers(layers.grid.n, layers.slope, layers.rough, layers.grid.res)
  poolLayers = layers
  return pool
}

/** Releases the planner workers (call on unmount). */
export function disposeMissionPlanner() {
  pool?.dispose()
  pool = null
  poolLayers = null
}

export const useMission = create<MissionState>((set, get) => ({
  layersStatus: 'idle',
  layersError: null,
  layers: null,
  placing: 'origin',
  origin: null,
  destination: null,
  planning: false,
  outcomes: {},
  profile: 'rover-rtg',
  setProfile: (profile) => set({ profile }),
  setPlacing: (placing) => set({ placing }),

  ensureLayers: async (ds) => {
    const s = get()
    if (s.layersStatus === 'loading' || s.layersStatus === 'ready') return
    set({ layersStatus: 'loading', layersError: null })
    try {
      const { loadPlanLayers } = await import('@/core/mission/plan-layers')
      const layers = await loadPlanLayers(ds)
      set({ layers, layersStatus: 'ready' })
      await getPool(layers)
      if (get().origin && get().destination) void runPlan(ds)
    } catch (e) {
      set({ layersStatus: 'error', layersError: e instanceof Error ? e.message : String(e) })
    }
  },

  place: (ds, p) => {
    const { placing } = get()
    if (placing === 'origin') set({ origin: p, placing: 'destination', outcomes: {} })
    else set({ destination: p, placing: 'origin' })
    if (get().origin && get().destination) void runPlan(ds)
  },

  clear: () => set({ origin: null, destination: null, outcomes: {}, placing: 'origin', planning: false }),
}))

async function runPlan(ds: Dataset) {
  const st = useMission.getState()
  const { layers, origin, destination } = st
  if (!layers || !origin || !destination) return
  const start = worldToCell(layers.grid, origin.x, origin.z)
  const goal = worldToCell(layers.grid, destination.x, destination.z)
  const mine = ++seq
  useMission.setState({ planning: true })
  const p = await getPool(layers)
  const res = await p.planAll({ start, goal })
  if (mine !== seq) return // a newer click superseded this plan
  const hf = ds.heightfield
  const slopeAt = (x: number, z: number) => {
    const c = worldToCell(layers.grid, x, z)
    return c < 0 ? 0 : layers.slope[c]!
  }
  const outcomes: MissionState['outcomes'] = {}
  for (const [id, r] of Object.entries(res) as Array<[MissionProfile, (typeof res)[MissionProfile]]>) {
    if (r.status === 'ok') {
      const path = pathToWorld(layers.grid, r.path)
      outcomes[id] = { status: 'ok', path, stats: pathStats(hf, path, slopeAt), expanded: r.expanded, ms: r.ms }
    } else if (r.status === 'no-route') {
      outcomes[id] = { status: 'no-route', message: r.message, ms: r.ms, requiredSlopeDeg: r.requiredSlopeDeg }
    } else outcomes[id] = { status: 'error', message: r.message }
  }
  useMission.setState({ outcomes, planning: false })
}
