import * as Comlink from 'comlink'
import { MAX_RUN_BYTES, type Episode, type TrajArrays } from '../contracts'
import type { RunLoadResult } from './run-service'
import type { RunWorkerApi } from './run.worker'

/**
 * Page-side run.json loader. The file is size-checked before it is read, then transferred to a
 * Worker that parses and validates it; a fresh Worker per load is terminated afterwards unless the
 * caller keeps the session for trajectory decoding.
 */
export interface RunWorkerHandle {
  api: Pick<RunWorkerApi, 'parse' | 'trajectory'>
  terminate(): void
}
export const createRunWorker = (): RunWorkerHandle => {
  const worker = new Worker(new URL('./run.worker.ts', import.meta.url), { type: 'module' })
  return { api: Comlink.wrap<RunWorkerApi>(worker), terminate: () => worker.terminate() }
}

export class RunSession {
  private constructor(
    readonly result: RunLoadResult,
    private handle: RunWorkerHandle,
  ) {}

  static async open(file: Blob, factory: () => RunWorkerHandle = createRunWorker, timeoutMs = 30_000): Promise<RunSession> {
    if (file.size <= 0) throw new Error('The file is empty')
    if (file.size > MAX_RUN_BYTES) throw new Error(`The file is larger than ${MAX_RUN_BYTES / 1048576} MB`)
    const buf = await file.arrayBuffer()
    const handle = factory()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('Timed out while reading the run file')), timeoutMs)
      })
      const result = await Promise.race([handle.api.parse(Comlink.transfer(buf, [buf])), timeout])
      return new RunSession(result, handle)
    } catch (e) {
      handle.terminate()
      throw e instanceof Error ? e : new Error(String(e))
    } finally {
      clearTimeout(timer)
    }
  }

  /** Decodes and sha256-verifies one trajectory; throws on mismatch. */
  trajectory(episode: Episode): Promise<TrajArrays> {
    if (!episode.trajectory) return Promise.reject(new Error('Episode has no trajectory'))
    return this.handle.api.trajectory(episode.trajectory)
  }

  close() {
    this.handle.terminate()
  }
}
