import { EnvLite, replayEpisode, type Episode, type EnvConfig, type Terrain, type TrajArrays } from '@/intelligence'

/**
 * Re-simulation of recorded episodes with env-lite. Every episode whose scenario family the browser can
 * reproduce is replayed step by step through the same dynamics as the Python environment; the outcome, step
 * count, path length, energy and every visited cell must match what the file says. What the browser cannot
 * reproduce is named, per family, and those episodes are NOT counted as verified (never silently skipped).
 */

export type Gap = 'no-energy' | 'no-rocks' | 'no-shelter' | 'no-idle'

interface Family {
  kind: EnvConfig['kind']
  maxSlopeDeg: number
  maxStepM: number
  speedMS: number
  maxSteps: number
  energyOn: boolean
  sols: number | null
  /** what the browser env cannot reproduce for this family */
  gaps: Gap[]
}

const ROVER = { maxSlopeDeg: 24, maxStepM: 0.525, speedMS: 0.042 }
const ASTRO = { maxSlopeDeg: 15, maxStepM: 0.3, speedMS: 1.0 }

/** Mirrors python/src/marsx/env/scenarios.py (_BUILTIN). Unknown ids are not re-simulable. */
export const FAMILIES: Record<string, Family> = {
  'jezero-v1/l1/rtg-geometry': { kind: 'rtg_rover', ...ROVER, maxSteps: 600, energyOn: false, sols: null, gaps: [] },
  'jezero-v1/l1/astronaut-geometry': { kind: 'astronaut', ...ASTRO, maxSteps: 600, energyOn: false, sols: null, gaps: [] },
  'jezero-v1/l3/rtg-hidden-rocks': { kind: 'rtg_rover', ...ROVER, maxSteps: 800, energyOn: false, sols: null, gaps: ['no-rocks'] },
  'jezero-v1/l2/solar-clear': { kind: 'solar_rover', ...ROVER, maxSteps: 800, energyOn: false, sols: 1, gaps: ['no-energy'] },
  'jezero-v1/l2/solar-storm': { kind: 'solar_rover', ...ROVER, maxSteps: 800, energyOn: false, sols: 1, gaps: ['no-energy'] },
  'jezero-v1/l2/rtg-storm': { kind: 'rtg_rover', ...ROVER, maxSteps: 800, energyOn: true, sols: 1, gaps: [] },
  'jezero-v1/l2/astronaut-clear': { kind: 'astronaut', ...ASTRO, maxSteps: 800, energyOn: true, sols: 1, gaps: ['no-shelter'] },
  // L3 = the L2 sols for each profile plus hidden rocks (python/src/marsx/bench/suite.py)
  'jezero-v1/l3/rtg-clear': { kind: 'rtg_rover', ...ROVER, maxSteps: 800, energyOn: true, sols: 1, gaps: ['no-rocks'] },
  'jezero-v1/l3/rtg-storm': { kind: 'rtg_rover', ...ROVER, maxSteps: 800, energyOn: true, sols: 1, gaps: ['no-rocks'] },
  'jezero-v1/l3/solar-clear': { kind: 'solar_rover', ...ROVER, maxSteps: 800, energyOn: false, sols: 1, gaps: ['no-rocks', 'no-energy'] },
  'jezero-v1/l3/solar-storm': { kind: 'solar_rover', ...ROVER, maxSteps: 800, energyOn: false, sols: 1, gaps: ['no-rocks', 'no-energy'] },
  'jezero-v1/l3/astronaut-clear': { kind: 'astronaut', ...ASTRO, maxSteps: 800, energyOn: true, sols: 1, gaps: ['no-rocks', 'no-shelter'] },
  'jezero-v1/l3/astronaut-storm': { kind: 'astronaut', ...ASTRO, maxSteps: 800, energyOn: true, sols: 1, gaps: ['no-rocks', 'no-shelter'] },
}

export const GAP_TEXT: Record<Gap, string> = {
  'no-idle': 'waiting draws idle power, which the browser environment does not model yet',
  'no-energy': 'solar energy needs the sun and shadow tables',
  'no-rocks': 'hidden rocks are generated offline from a NumPy seed',
  'no-shelter': 'the shelter rule needs the space-weather alert schedule',
}

export function configFor(id: string): EnvConfig | null {
  const f = FAMILIES[id]
  if (!f) return null
  return {
    kind: f.kind,
    maxSlopeDeg: f.maxSlopeDeg,
    maxStepM: f.maxStepM,
    speedMS: f.speedMS,
    gravity: 3.694,
    reward: { energy: 0, risk: 0, time: 0, progress: 0.3, goal: 10, failure: 10, hazardAttempt: 1, stepCost: 0.1 },
    maxSteps: f.maxSteps,
    energyOn: f.energyOn,
    sensorRadiusM: f.gaps.includes('no-rocks') ? 8 : 0,
    waitS: 60,
    sols: f.sols,
  }
}

/** Whether an episode can be replayed here, and why not. Pure, so it is unit-tested. */
export function resimulability(ep: Episode, familyId: string): { ok: true } | { ok: false; why: string } {
  const f = FAMILIES[familyId]
  if (!f) return { ok: false, why: 'unknown scenario family' }
  if (!ep.trajectory) return { ok: false, why: 'no trajectory recorded' }
  if (f.gaps.includes('no-rocks') && (ep.outcome === 'collision' || ep.violations > 0)) return { ok: false, why: GAP_TEXT['no-rocks'] }
  if (f.gaps.includes('no-energy') && ep.outcome === 'battery') return { ok: false, why: GAP_TEXT['no-energy'] }
  if (f.gaps.includes('no-shelter') && (ep.outcome === 'spe_violation' || ep.events.some((e) => e.type === 'speAlert' || e.type === 'shelterReached'))) return { ok: false, why: GAP_TEXT['no-shelter'] }
  return { ok: true }
}

export interface VerificationSummary {
  /** episodes replayed with a match */
  verified: number
  mismatched: number
  notResimulable: number
  total: number
  /** first mismatches, for display */
  examples: { index: number; reason: string }[]
  /** why episodes could not be replayed: reason -> count */
  gaps: Record<string, number>
  state: 'verified' | 'mismatch' | 'not-resimulated'
}

/**
 * Where the scenario has the energy model off, the file still records the energy the agent would have spent
 * (python computes it anyway) but env-lite does not integrate it, so only the energy lines are ignored there.
 */
export function relevantMismatches(mismatches: readonly string[], energyOn: boolean): string[] {
  return energyOn ? [...mismatches] : mismatches.filter((m) => !/^energy:|battery level differs/.test(m))
}

/** The last entry carries the WAIT sentinel (traj/1), so only the earlier actions count. */
export function waitsBeforeEnd(traj: Pick<TrajArrays, 'action'>): boolean {
  for (let i = 0; i < traj.action.length - 1; i++) if (traj.action[i] === 8) return true
  return false
}

export function summaryState(s: Pick<VerificationSummary, 'verified' | 'mismatched'>): VerificationSummary['state'] {
  return s.mismatched > 0 ? 'mismatch' : s.verified > 0 ? 'verified' : 'not-resimulated'
}

export async function verifyRun(
  episodes: readonly Episode[],
  runScenarioId: string,
  terrain: Terrain,
  getTrajectory: (ep: Episode) => Promise<TrajArrays>,
  onProgress?: (done: number, total: number) => void,
): Promise<VerificationSummary> {
  const envs = new Map<string, EnvLite | null>()
  const out: VerificationSummary = { verified: 0, mismatched: 0, notResimulable: 0, total: episodes.length, examples: [], gaps: {}, state: 'not-resimulated' }
  const gap = (why: string) => {
    out.notResimulable++
    out.gaps[why] = (out.gaps[why] ?? 0) + 1
  }
  const bad = (index: number, reason: string) => {
    out.mismatched++
    if (out.examples.length < 5) out.examples.push({ index, reason })
  }
  let tick = Date.now()
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i]!
    const fam = ep.scenarioId ?? runScenarioId
    const can = resimulability(ep, fam)
    if (!can.ok) gap(can.why)
    else {
      let env = envs.get(fam)
      if (env === undefined) {
        const cfg = configFor(fam)
        env = cfg ? new EnvLite(terrain, cfg) : null
        envs.set(fam, env)
      }
      if (!env) gap('unknown scenario family')
      else {
        try {
          const traj = await getTrajectory(ep)
          if (env.cfg.energyOn && waitsBeforeEnd(traj)) {
            gap(GAP_TEXT['no-idle'])
            continue
          }
          const r = replayEpisode(env, ep, traj)
          const real = relevantMismatches(r.mismatches, env.cfg.energyOn)
          if (real.length === 0) out.verified++
          else bad(ep.index, real[0]!)
        } catch (e) {
          bad(ep.index, e instanceof Error ? e.message : String(e))
        }
      }
    }
    if (Date.now() - tick > 40) {
      tick = Date.now()
      onProgress?.(i + 1, episodes.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  onProgress?.(episodes.length, episodes.length)
  out.state = summaryState(out)
  return out
}
