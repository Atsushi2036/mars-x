import * as Comlink from 'comlink'
import type { PlannerWorkerApi } from './planner.worker'
import type { PlanResult } from './planner-service'
import { PROFILES, PROFILE_IDS, type Profile, type ProfileId } from './profiles'

export interface PlannerHandle {
  api: Pick<PlannerWorkerApi, 'setLayers' | 'plan'> | { setLayers: (...a: never[]) => unknown; plan: (r: unknown) => unknown }
  terminate(): void
}
export type PlannerFactory = () => PlannerHandle

/** Real Web Worker + Comlink handle (browser only). */
export function createPlannerWorker(): PlannerHandle {
  const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' })
  return { api: Comlink.wrap<PlannerWorkerApi>(worker), terminate: () => worker.terminate() }
}

export interface PlanQuery {
  start: number
  goal: number
  /** per-profile overrides of the cost weights (live lab sliders) */
  overrides?: Partial<Record<ProfileId, Partial<Pick<Profile, 'ws' | 'wr' | 'maxSlope'>>>>
}

export type PlanAllResult = Record<ProfileId, PlanResult | { status: 'error'; profileId: ProfileId; message: string }>

interface Slot {
  handle: PlannerHandle
}

/**
 * One Worker per profile so astronaut, RTG rover and solar rover plan in parallel. A Worker that
 * errors or exceeds `timeoutMs` is terminated and respawned (layers re-sent) so a bad query can
 * never wedge the lab.
 */
export class PlannerPool {
  private slots = new Map<ProfileId, Slot>()
  private layers: { n: number; slope: Float32Array; rough: Float32Array; resM: number } | null = null
  private disposed = false

  constructor(
    private factory: PlannerFactory = createPlannerWorker,
    private timeoutMs = 10_000,
    private profiles: readonly ProfileId[] = PROFILE_IDS,
  ) {}

  /**
   * Hands the layers to every Worker. Each Worker receives its own copy (transferred), so the
   * caller keeps its arrays.
   */
  async setLayers(n: number, slope: Float32Array, rough: Float32Array, resM = 2): Promise<void> {
    this.layers = { n, slope, rough, resM }
    await Promise.all(this.profiles.map((id) => this.loadSlot(id)))
  }

  private async loadSlot(id: ProfileId): Promise<void> {
    if (!this.layers) return
    let slot = this.slots.get(id)
    if (!slot) {
      slot = { handle: this.factory() }
      this.slots.set(id, slot)
    }
    const { n, slope, rough } = this.layers
    const s = slope.slice()
    const r = rough.slice()
    const api = slot.handle.api as PlannerWorkerApi
    await api.setLayers(n, Comlink.transfer(s, [s.buffer]), Comlink.transfer(r, [r.buffer]))
  }

  private respawn(id: ProfileId) {
    this.slots.get(id)?.handle.terminate()
    this.slots.delete(id)
  }

  async plan(id: ProfileId, q: PlanQuery): Promise<PlanAllResult[ProfileId]> {
    if (this.disposed || !this.layers) return { status: 'error', profileId: id, message: 'Planner not ready' }
    const p = PROFILES[id]
    const ov = q.overrides?.[id] ?? {}
    const request = {
      profileId: id,
      weights: { ws: ov.ws ?? p.ws, wr: ov.wr ?? p.wr, maxSlope: ov.maxSlope ?? p.maxSlope },
      start: q.start,
      goal: q.goal,
      resM: this.layers.resM,
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const slot = this.slots.get(id)
      if (!slot) await this.loadSlot(id)
      const api = this.slots.get(id)!.handle.api as PlannerWorkerApi
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Planner timed out after ${this.timeoutMs} ms`)), this.timeoutMs)
      })
      return (await Promise.race([api.plan(request), timeout])) as PlanResult
    } catch (e) {
      this.respawn(id)
      return { status: 'error', profileId: id, message: e instanceof Error ? e.message : String(e) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** All profiles in parallel. */
  async planAll(q: PlanQuery): Promise<PlanAllResult> {
    const entries = await Promise.all(this.profiles.map(async (id) => [id, await this.plan(id, q)] as const))
    return Object.fromEntries(entries) as PlanAllResult
  }

  dispose() {
    this.disposed = true
    for (const id of [...this.slots.keys()]) this.respawn(id)
  }
}
