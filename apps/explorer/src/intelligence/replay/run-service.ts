import { MAX_RUN_BYTES, runSchema, type Run } from '../contracts'
import { computeMetrics, diffMetrics, type MetricDiff, type Metrics } from '../sim/metrics'

/**
 * Worker-side run.json loader (security: ADR-0007). Untrusted bytes are parsed HERE, never on the main
 * thread: size cap, JSON.parse, zod .strict() (unknown keys rejected, numbers finite, lengths capped),
 * then metrics are recomputed from the episodes and compared with what the file claims. Strings in the
 * result are data to render as text only; nothing in a run is ever followed, fetched or evaluated.
 */

export interface RunLoadResult {
  run: Run
  /** metrics recomputed from the episodes (the ones to display) */
  recomputed: Metrics
  /** claimed-vs-recomputed discrepancies; non-empty = the file's own numbers cannot be trusted */
  metricDiffs: MetricDiff[]
  bytes: number
}

export class RunValidationError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message)
    this.name = 'RunValidationError'
  }
}

/** Parse + validate + verify. Error messages never echo file content (only a schema path). */
export function parseRun(buffer: ArrayBuffer): RunLoadResult {
  if (buffer.byteLength === 0) throw new RunValidationError('The file is empty', '')
  if (buffer.byteLength > MAX_RUN_BYTES) throw new RunValidationError(`The file is larger than ${MAX_RUN_BYTES / 1048576} MB`, '')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
  } catch {
    throw new RunValidationError('The file is not valid UTF-8 JSON', '')
  }
  const r = runSchema.safeParse(json)
  if (!r.success) {
    const issue = r.error.issues[0]
    const p = issue ? issue.path.map(String).join('.').slice(0, 120) : ''
    const code = issue?.code ?? 'invalid'
    throw new RunValidationError(`Not a valid MARS-X run/1 file (${code} at ${p || 'root'})`, p)
  }
  const run = r.data
  for (const e of run.episodes) {
    if (e.trajectory && e.trajectory.steps !== e.steps + 1 && e.trajectory.steps !== e.steps) {
      throw new RunValidationError(`Episode ${e.index}: trajectory length does not match steps`, `episodes.${e.index}.trajectory`)
    }
  }
  const recomputed = computeMetrics(run.episodes)
  return { run, recomputed, metricDiffs: diffMetrics(run.metrics, recomputed), bytes: buffer.byteLength }
}
