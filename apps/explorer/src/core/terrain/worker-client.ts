import * as Comlink from 'comlink'
import type { Dataset } from '@/core/data/loader'
import type { TerrainWorkerApi } from './terrain.worker'

export interface TerrainWorker {
  api: Comlink.Remote<TerrainWorkerApi>
  dispose: () => void
}

/** Starts the terrain worker and hands it the elevation raster (ownership of the buffer moves to the worker). */
export async function createTerrainWorker(ds: Dataset): Promise<TerrainWorker> {
  const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' })
  const api = Comlink.wrap<TerrainWorkerApi>(worker)
  const e = ds.elevationLayer.encoding
  const hf = ds.heightfield
  await api.init(
    Comlink.transfer(ds.rawU16, [ds.rawU16.buffer]),
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
