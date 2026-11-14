/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { decodeTrajectory, type TrajArrays, type Episode } from '../contracts'
import { parseRun } from './run-service'

const api = {
  async parse(buffer: ArrayBuffer) {
    return parseRun(buffer)
  },
  /** decode + sha256-verify one episode trajectory (transfers the typed arrays) */
  async trajectory(trajectory: NonNullable<Episode['trajectory']>): Promise<TrajArrays> {
    const t = await decodeTrajectory(trajectory)
    return Comlink.transfer(t, [t.row.buffer, t.col.buffer, t.tS.buffer, t.socHalf.buffer, t.action.buffer])
  },
}
export type RunWorkerApi = typeof api

Comlink.expose(api)
