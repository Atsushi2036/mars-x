import { cellToWorld, worldToCell } from '@/core/mission/geometry'
import { loadSimTerrain } from '@/features/replay/sim-terrain'
import { configFor } from '@/features/replay/verify'
import { policyCardSchema } from '@/intelligence/contracts'
import { loadCatalogModel } from '@/features/shared/model-catalog'
import { LiveTrack, MAX_DRIVE_STEPS, runDrive, subGoals, type Cell, type DriveResult } from '@/intelligence/drive/drive-loop'
import { markCatalogLoad, useUserModel } from '@/intelligence/drive/user-model'
import { PolicyClient } from '@/intelligence/policy/policy-client'
import { EnvLite } from '@/intelligence/sim/env-lite'
import { useApp } from './app'
import { agentLive } from './camera'
import { catalogId, GUIDED_SPACING_M, trainedRangeWarning, useDriver, type AiDriverKind, type DriveSummary } from './driver'
import { useMission, type MissionProfile } from './mission'
import { fmtMission, pathLength, usePlayback, type PlaybackEvent } from './playback'
import { roverLive, useRover } from './rover'
import { ROVER_REAL_SPEED, startRouteWatch, visualSpeed, watchCtx } from './watch'
import { curveFor } from '@/core/rover/curve'

/** Playback speed of a live drive at 1x, steps per second (the policy itself runs as fast as the worker answers). */
export const DRIVE_RATE = 30

const FAMILY: Record<MissionProfile, { id: string; kind?: 'solar_rover' }> = {
  'rover-rtg': { id: 'jezero-v1/l1/rtg-geometry' },
  'rover-solar': { id: 'jezero-v1/l1/rtg-geometry', kind: 'solar_rover' },
  astronaut: { id: 'jezero-v1/l1/astronaut-geometry' },
}

let makeClient: () => PolicyClient = () => new PolicyClient()
/** Tests inject a client around a fake worker. */
export function setPolicyClientFactory(f: () => PolicyClient): void {
  makeClient = f
}

let active: { ctl: AbortController; client: PolicyClient } | null = null

/** Stops a running drive and frees its worker (called when the Watch ends). */
export function stopAiDrive(): void {
  active?.ctl.abort()
  active?.client.terminate()
  active = null
}

/** Marker list the playback bar shows for a (possibly still growing) drive. */
export function liveEvents(track: LiveTrack, summary: DriveSummary | null, cum: ArrayLike<number>, speed: number): PlaybackEvent[] {
  const at = (i: number) => (cum[Math.min(i, track.count - 1)] ?? 0) / speed
  const out: PlaybackEvent[] = []
  let blocked = 0
  let lastBlocked = -100
  for (const e of track.events) {
    if (e.kind === 'blocked') {
      // a policy pushing against a wall is one marker, not hundreds: bumps within 6 steps merge, and the bar never shows more than 40
      if (e.at - lastBlocked < 6) {
        lastBlocked = e.at
        continue
      }
      lastBlocked = e.at
      if (++blocked > 40) continue
      out.push({ t: at(e.at), kind: 'stuck', label: 'Blocked move' })
    } else if (e.kind === 'rock') out.push({ t: at(e.at), kind: 'rock', label: 'Hit an obstacle' })
    else out.push({ t: at(e.at), kind: summary?.outcome === 'success' ? 'end' : 'stuck', label: summary ? (summary.outcome === 'success' ? 'Reached the goal' : 'Run ended') : 'End' })
  }
  return out
}

async function loadModel(kind: AiDriverKind, client: PolicyClient): Promise<void> {
  const cid = catalogId(kind)
  if (cid) {
    // a catalog model takes the lab's validated download (sha256 checked) and lands in the loaded-policy slot, then runs in our worker
    const entry = useDriver.getState().catalog.find((m) => m.id === cid)
    const base = useApp.getState().dataset?.base
    if (!entry || !base) throw new Error('That model is not in this build')
    markCatalogLoad(cid)
    await loadCatalogModel(base, entry)
    const f = useUserModel.getState().file
    if (!f) throw new Error('The model could not be loaded')
    const loaded = await client.load(f)
    if (loaded.sha256 !== entry.sha256) throw new Error('The model does not match its catalog entry')
    return
  }
  if (kind === 'user') {
    const f = useUserModel.getState().file
    if (!f) throw new Error('No model is loaded in Test your AI')
    await client.load(f)
    return
  }
  const base = useApp.getState().dataset?.base
  if (!base) throw new Error('The dataset is not loaded')
  const [onnx, cardRes] = await Promise.all([fetch(`${base}/models/policy.onnx`), fetch(`${base}/models/policy-card.json`)])
  const isBinary = onnx.ok && !(onnx.headers.get('content-type') ?? '').includes('text/html')
  if (!isBinary) throw new Error('The reference model is not published with this build')
  const card = cardRes.ok && (cardRes.headers.get('content-type') ?? '').includes('json') ? policyCardSchema.parse(await cardRes.json()) : null
  if (!card) throw new Error('The reference model card is missing')
  const loaded = await client.load(await onnx.blob())
  if (loaded.sha256 !== card.onnxSha256) throw new Error('The reference model does not match its card')
}

function fallback(reason: string): boolean {
  useDriver.setState({ phase: 'idle', notice: `${reason} Showing the A* plan instead.` })
  return startRouteWatch()
}

/**
 * Watch with an AI driver: loads the policy into the sandboxed worker, then RUNS it live in env-lite from the route's start to its
 * goal. The agent follows the trajectory the policy produces while it is produced (amber trail, A* stays cyan for comparison).
 * Any failure (no model, bad file, worker error) falls back to the A* Watch with a notice.
 */
export async function startAiWatch(kind: AiDriverKind): Promise<boolean> {
  if (useDriver.getState().phase === 'loading') return false
  const m = useMission.getState()
  const out = m.outcomes[m.profile]
  const ds = useApp.getState().dataset
  const layers = m.layers
  if (!out || out.status !== 'ok' || out.path.length < 2 || !layers || !ds) return startRouteWatch()
  const grid = layers.grid
  const a = out.path[0]!
  const b = out.path[out.path.length - 1]!
  const si = worldToCell(grid, a.x, a.z)
  const gi = worldToCell(grid, b.x, b.z)
  if (si < 0 || gi < 0) return fallback('The route is outside the planning grid.')
  const start: Cell = [Math.floor(si / grid.n), si % grid.n]
  const goal: Cell = [Math.floor(gi / grid.n), gi % grid.n]
  const mode = useDriver.getState().mode
  // guided: A* sub-goals along its own cells, one every ~25 m; free: only the real goal
  const cells: Cell[] = []
  for (const p of out.path) {
    const ci = worldToCell(grid, p.x, p.z)
    if (ci >= 0) {
      const c: Cell = [Math.floor(ci / grid.n), ci % grid.n]
      const l = cells[cells.length - 1]
      if (!l || l[0] !== c[0] || l[1] !== c[1]) cells.push(c)
    }
  }
  const goals: Cell[] = mode === 'guided' && cells.length > 2 ? subGoals(cells, GUIDED_SPACING_M / grid.res) : [goal]
  const straightM = Math.hypot(b.x - a.x, b.z - a.z)

  useDriver.setState({ phase: 'loading', notice: null, summary: null })
  const ctl = new AbortController()
  const client = makeClient()
  active = { ctl, client }
  let env: EnvLite
  try {
    const terrain = await loadSimTerrain(ds)
    if (terrain.rows !== grid.n || terrain.cols !== grid.n) throw new Error('The simulation grid does not match the planning grid.')
    await loadModel(kind, client)
    const fam = FAMILY[m.profile]
    const cfg = configFor(fam.id)!
    const cap = Math.min(MAX_DRIVE_STEPS, Math.max(600, Math.ceil((straightM / grid.res) * 6)))
    env = new EnvLite(terrain, { ...cfg, ...(fam.kind ? { kind: fam.kind } : {}), maxSteps: cap })
  } catch (e) {
    stopAiDrive()
    return fallback(`Could not run the model: ${e instanceof Error ? e.message : String(e)}.`)
  }
  if (ctl.signal.aborted) return false

  const cap = env.cfg.maxSteps
  const track = new LiveTrack(cap + 1)
  const x = new Float32Array(cap + 2)
  const z = new Float32Array(cap + 2)
  const astro = m.profile === 'astronaut'
  // the replay of the drive moves at the very pace of the A* route Watch, and the clock shows real mission time the same way
  const speed = visualSpeed(curveFor(out.path).length, astro)
  const timeScale = speed / (astro ? m.walk.speedMs : ROVER_REAL_SPEED)
  const w0 = cellToWorld(grid, start[0] * grid.n + start[1])
  x[0] = w0.x
  z[0] = w0.z
  agentLive.kind = astro ? 'astronaut' : 'rover'
  roverLive.x = w0.x
  roverLive.z = w0.z
  roverLive.yaw = Math.atan2(b.z - a.z, b.x - a.x)
  useRover.getState().stop()
  watchCtx.current = {
    kind: 'run',
    x,
    z,
    tS: new Uint32Array(0),
    last: 0,
    step: 0,
    yaw: roverLive.yaw,
    live: { track, grid, filled: 1, cum: new Float32Array(cap + 3), speed, abort: () => ctl.abort() },
  }
  const warn = trainedRangeWarning(straightM)
  useDriver.setState({ phase: 'driving', notice: warn })
  usePlayback.getState().begin({ source: 'route', duration: 1, timeScale, label: (t) => fmtMission(t * timeScale), events: [], ai: true })

  const astarM = pathLength(out.path)
  void runDrive({
    env,
    start,
    goals,
    track,
    signal: ctl.signal,
    infer: async (obs) => (await client.infer(obs, 1)).actions[0]!,
  }).then((res: DriveResult) => {
    if (ctl.signal.aborted && res.outcome === 'aborted') return
    const summary: DriveSummary = { kind, outcome: res.outcome, steps: res.steps, pathM: res.pathM, astarM, mode, reached: res.reached, total: res.total, blockedAttempts: res.blockedAttempts, ...(res.error ? { error: res.error } : {}) }
    stopAiDrive()
    if (res.outcome === 'error') {
      usePlayback.getState().exit()
      fallback(`The model failed (${res.error ?? 'unknown error'}).`)
      return
    }
    useDriver.setState({ phase: 'done', summary })
  })
  return true
}

