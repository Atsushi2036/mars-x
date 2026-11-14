import type { Dataset } from '@/core/data/loader'
import { f32FromBytes, OwltTable, SunTable } from '@/intelligence/conditions/tables'
import { medaSummarySchema, type MedaSummary } from './conditions'

/**
 * Loads the condition tables published with the dataset. Everything is optional: a missing file means
 * "No data" in the UI, never a default value.
 */
const cache = new Map<string, Promise<unknown>>()

function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) {
    p = make()
    cache.set(key, p)
  }
  return p
}

async function fetchBytes(url: string, expected: number): Promise<Uint8Array | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const buf = new Uint8Array(await res.arrayBuffer())
  return buf.byteLength === expected ? buf : null
}

export async function loadSunTable(ds: Dataset, sol: number): Promise<{ table: SunTable; startMs: number } | null> {
  const layer = ds.manifest.layers.find((l) => l.kind === 'sun_table' && l.id === `sun_sol_${sol}`)
  if (!layer?.table) return null
  const meta = layer.table
  return once(`${ds.base}|sun|${sol}`, async () => {
    const bytes = await fetchBytes(`${ds.base}/${layer.path}`, layer.bytes)
    if (!bytes) return null
    const startMs = Date.parse(meta.startUtc)
    return { table: new SunTable(f32FromBytes(bytes), { startMs, stepS: meta.stepS }), startMs }
  })
}

export async function loadOwltTable(ds: Dataset): Promise<OwltTable | null> {
  const layer = ds.manifest.layers.find((l) => l.kind === 'owlt_table')
  if (!layer?.table) return null
  const meta = layer.table
  return once(`${ds.base}|owlt`, async () => {
    const bytes = await fetchBytes(`${ds.base}/${layer.path}`, layer.bytes)
    if (!bytes) return null
    return new OwltTable(f32FromBytes(bytes), { startMs: Date.parse(meta.startUtc), stepS: meta.stepS })
  })
}

/** Optional daily MEDA summary at `<dataset>/meda/sol-NNNN.json`; null when it is not published or is malformed. */
export async function loadMeda(ds: Dataset, sol: number): Promise<MedaSummary | null> {
  return once(`${ds.base}|meda|${sol}`, async () => {
    try {
      const res = await fetch(`${ds.base}/meda/sol-${String(sol).padStart(4, '0')}.json`)
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
      const parsed = medaSummarySchema.safeParse(await res.json())
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  })
}
