import { create } from 'zustand'
import type { PlanLayers } from '@/core/mission/plan-layers'
import { pathStats, pathToWorld, worldToCell, type PathStats, type XZ } from '@/core/mission/geometry'
import type { Dataset } from '@/core/data/loader'
import { loadScienceTargets, type ScienceTarget } from '@/core/mission/science-targets'
import { DEFAULT_WALK, type WalkParams } from '@/core/mission/marswalk'
import { useApp } from './app'
import { focusBounds } from './camera'
import { roverLive } from './rover'

/** a goal closer than this to the start is rejected (metres): the planner would return a one-cell path */
export const MIN_GOAL_DISTANCE_M = 20
export const GOAL_TOO_CLOSE = 'Pick a goal farther from the start'

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
  /** wall-clock time of the last planAll (all profiles in parallel), ms; null before the first plan */
  planWallMs: number | null
  /** short message about the last rejected tap (a goal too close to the start), cleared after a few seconds */
  placeNotice: string | null
  /** astronaut slope limit used for planning (assumption, 15 deg by default, up to 20) */
  astronautSlopeLimit: number
  /** Marswalk assumptions (EVA hours, speed, stop time, shelter window) */
  walk: WalkParams
  scienceTargets: ScienceTarget[]
  scienceStatus: 'idle' | 'loading' | 'ready' | 'error'
  scienceTargetId: string | null
  setAstronautSlopeLimit: (deg: number) => void
  setWalk: (patch: Partial<WalkParams>) => void
  ensureScienceTargets: (ds: Dataset) => Promise<void>
  setProfile: (p: MissionProfile) => void
  setPlacing: (p: 'origin' | 'destination') => void
  ensureLayers: (ds: Dataset) => Promise<void>
  place: (ds: Dataset, p: XZ) => void
  clear: () => void
}

let pool: import('@/intelligence/nav/planner-pool').PlannerPool | null = null
let poolLayers: PlanLayers | null = null
let seq = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined

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
  planWallMs: null,
  placeNotice: null,
  astronautSlopeLimit: 15,
  walk: DEFAULT_WALK,
  scienceTargets: [],
  scienceStatus: 'idle',
  scienceTargetId: null,
  setAstronautSlopeLimit: (deg) => {
    set({ astronautSlopeLimit: Math.min(20, Math.max(5, deg)) })
    const ds = useApp.getState().dataset
    if (ds && get().origin && get().destination) void runPlan(ds)
  },
  setWalk: (patch) => set((s) => ({ walk: { ...s.walk, ...patch } })),
  ensureScienceTargets: async (ds) => {
    const st = get().scienceStatus
    if (st === 'loading' || st === 'ready') return
    set({ scienceStatus: 'loading' })
    try {
      set({ scienceTargets: await loadScienceTargets(ds), scienceStatus: 'ready' })
    } catch {
      set({ scienceStatus: 'error' })
    }
  },
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
    if (placing === 'origin') set({ origin: p, placing: 'destination', outcomes: {}, scienceTargetId: null })
    else {
      const o = get().origin
      // same 2 m cell, or a few metres away: there is no route to plan. Keep the Goal step open and say why.
      if (o && Math.hypot(p.x - o.x, p.z - o.z) < MIN_GOAL_DISTANCE_M) {
        set({ placeNotice: GOAL_TOO_CLOSE })
        clearTimeout(noticeTimer)
        noticeTimer = setTimeout(() => useMission.setState({ placeNotice: null }), 3500)
        return
      }
      set({ destination: p, placing: 'origin', scienceTargetId: null, placeNotice: null })
    }
    if (get().origin && get().destination) void runPlan(ds)
  },

  clear: () => set({ origin: null, destination: null, outcomes: {}, placing: 'origin', planning: false, scienceTargetId: null }),
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
  const t0 = performance.now()
  const res = await p.planAll({ start, goal, overrides: { astronaut: { maxSlope: st.astronautSlopeLimit } } })
  const wall = performance.now() - t0
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
      const stats = pathStats(hf, path, slopeAt)
      // a path shorter than a metre is not a route (start and goal in the same cell): never reported as ready
      if (stats.lengthM < 1) outcomes[id] = { status: 'no-route', message: 'The start and the goal are too close together.', ms: r.ms, requiredSlopeDeg: null }
      else outcomes[id] = { status: 'ok', path, stats, expanded: r.expanded, ms: r.ms }
    } else if (r.status === 'no-route') {
      outcomes[id] = { status: 'no-route', message: r.message, ms: r.ms, requiredSlopeDeg: r.requiredSlopeDeg }
    } else outcomes[id] = { status: 'error', message: r.message }
  }
  useMission.setState({ outcomes, planning: false, planWallMs: wall })
}

// --------------------------------------------------------------------------- public API (guided mission, tests)

/** Selects the traverse profile (astronaut = Marswalk panel). */
export function setMissionProfile(profile: MissionProfile): void {
  useMission.getState().setProfile(profile)
}

/** Sets origin and destination (world metres: x east, z south) and plans all profiles. Loads the planning layers if needed. */
export async function setMissionEndpoints(start: XZ, goal: XZ): Promise<void> {
  await applyEndpoints(start, goal, null)
}

async function applyEndpoints(start: XZ, goal: XZ, targetId: string | null): Promise<void> {
  const ds = useApp.getState().dataset
  if (!ds) return
  useMission.setState({ origin: start, destination: goal, placing: 'origin', outcomes: {}, scienceTargetId: targetId })
  const st = useMission.getState()
  if (st.layersStatus === 'ready') await runPlan(ds)
  else await st.ensureLayers(ds) // plans by itself once the layers are ready
}

/**
 * Picks a science stop (a Perseverance waypoint id such as "wp-718-34-3196", or a mineral patch id) as the destination.
 * The origin is the shelter: the existing origin, or the rover parking spot when none is set. Resolves false for an unknown id.
 */
export async function selectScienceTarget(id: string): Promise<boolean> {
  const ds = useApp.getState().dataset
  if (!ds) return false
  await useMission.getState().ensureScienceTargets(ds)
  const target = useMission.getState().scienceTargets.find((t) => t.id === id)
  if (!target) return false
  const origin = useMission.getState().origin ?? { x: roverLive.x, z: roverLive.z }
  await applyEndpoints(origin, { x: target.x, z: target.z }, id)
  // frame the whole walk (shelter, route and stop) in the 3D view once it is planned
  const out = useMission.getState().outcomes.astronaut
  const pts = out && out.status === 'ok' ? out.path : [origin, { x: target.x, z: target.z }]
  focusBounds({
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  })
  return true
}
