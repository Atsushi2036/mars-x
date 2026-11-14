import { halfToFloat, type Episode, type TrajArrays } from '../contracts'
import type { EnvLite, EnvState } from './env-lite'

/**
 * Replays a recorded trajectory through env-lite and RECOMPUTES the episode result, so the UI shows
 * what the dynamics say, not what the file claims. traj/1 convention (python NavBatch record=True):
 * point 0 = start (action WAIT), point i = cell after action i.
 */
export interface ReplayReport {
  ok: boolean
  /** human-readable discrepancies (first 20) */
  mismatches: string[]
  recomputed: EnvState
  /** per-step states, for scrubbing in the 3D replay */
  states: EnvState[]
}

const SOC_TOL = 2e-3 // float16 storage in traj/1
const T_TOL = 1 // traj/1 stores whole seconds (uint32)

export function replayEpisode(env: EnvLite, ep: Episode, traj: TrajArrays): ReplayReport {
  const bad: string[] = []
  const note = (m: string) => {
    if (bad.length < 20) bad.push(m)
  }
  const n = traj.row.length
  env.reset(ep.start, ep.goal)
  if (n === 0 || traj.row[0] !== ep.start[0] || traj.col[0] !== ep.start[1]) note('trajectory does not begin at the episode start')
  const states: EnvState[] = [{ ...env.state }]
  for (let i = 1; i < n; i++) {
    env.step(traj.action[i]!)
    const s = env.state
    states.push({ ...s })
    if (s.row !== traj.row[i] || s.col !== traj.col[i]) {
      note(`step ${i}: expected cell (${traj.row[i]}, ${traj.col[i]}) but the dynamics give (${s.row}, ${s.col})`)
      break
    }
    if (Math.abs(s.tS - traj.tS[i]!) > T_TOL) note(`step ${i}: time differs (${traj.tS[i]} s vs ${s.tS.toFixed(1)} s)`)
    if (env.cfg.energyOn && Math.abs(s.soc - halfToFloat(traj.socHalf[i]!)) > SOC_TOL) note(`step ${i}: battery level differs`)
    if (s.outcome !== '') break
  }
  const r = env.state
  if (r.outcome !== ep.outcome) note(`outcome: file says ${ep.outcome}, dynamics give ${r.outcome || 'running'}`)
  if (r.steps !== ep.steps) note(`steps: file says ${ep.steps}, dynamics give ${r.steps}`)
  if (Math.abs(r.pathM - ep.pathM) > 1e-3) note(`path length: file says ${ep.pathM} m, dynamics give ${r.pathM.toFixed(3)} m`)
  if (ep.energyWh != null && Math.abs(r.energyWh - ep.energyWh) > 0.01) note(`energy: file says ${ep.energyWh} Wh, dynamics give ${r.energyWh.toFixed(3)} Wh`)
  if (r.violations !== ep.violations) note(`violations: file says ${ep.violations}, dynamics give ${r.violations}`)
  return { ok: bad.length === 0, mismatches: bad, recomputed: { ...r }, states }
}
