import * as Comlink from 'comlink'
import type { Dataset } from '@/core/data/loader'
import type { TerrainWorkerApi } from './terrain.worker'

export interface TerrainWorker {
  api: Comlink.Remote<TerrainWorkerApi>
  dispose: () => void
}

/** Starts the terrain worker and hands it a COPY of the elevation raster (8 MB for 2048^2), so a remount can never meet a detached buffer. */
export async function createTerrainWorker(ds: Dataset): Promise<TerrainWorker> {
  const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<TerrainWorkerApi>(worker)
  const e = ds.elevationLayer.encoding
  const hf = ds.heightfield
  const copy = ds.rawU16.slice()
  await api.init(
    Comlink.transfer(copy, [copy.buffer]),
    { scale: e.scale ?? 1, offset: e.offset ?? 0, nodata: e.nodata ?? 65535 },
    {
      width: hf.width,
      height: hf.height,
      res: hf.res,
      transform: [hf.res, 0, hf.x0, 0, -hf.res, hf.y0],
      center: hf.center,
    },
  )
  return {
    api,
    dispose: () => {
      api[Comlink.releaseProxy]()
      worker.terminate()
    },
  }
}
