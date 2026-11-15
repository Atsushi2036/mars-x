import { useEffect } from 'react'
import { create } from 'zustand'
import { z } from 'zod'
import { useApp } from '@/store/app'
import { useByo } from './byo-store'

/**
 * Catalog of ready-made models published with the build (models/catalog.json): the PPO reference and an example
 * student model. Loading one takes the SAME validated path as dropping the file: the bytes become a File and go to
 * the byo-store actions, whose Workers run the ONNX validator, the sandboxed session and the run.json re-simulation.
 * Paths are relative to the dataset folder (/data/<region>/) and may not leave it.
 */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const relPath = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'relative path')
  .refine((p) => !p.split('/').includes('..') && !p.includes('//'), 'must stay inside the dataset folder')
const result = z.object({ success: z.number().min(0).max(1), n: z.number().int().positive() }).strict()

export const catalogEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
    kind: z.enum(['reference', 'example']),
    name: z.string().min(1).max(80),
    version: z.string().max(32),
    sha256,
    onnx: relPath,
    card: relPath,
    /** official run.json per level, when the build ships it */
    runs: z.object({ L1: relPath.optional(), L2: relPath.optional() }).strict(),
    /** result on the official suite (re-simulated by the team), never the in-distribution number */
    official: z.object({ suite: z.string().max(40), L1: result.optional(), L2: result.optional() }).strict(),
    passesL1: z.boolean(),
  })
  .strict()
export type CatalogEntry = z.infer<typeof catalogEntrySchema>

export const catalogSchema = z.object({ schemaVersion: z.literal('catalog/1'), models: z.array(catalogEntrySchema).max(20) }).strict()
export type Catalog = z.infer<typeof catalogSchema>

export type RunLevel = 'L1' | 'L2'
const MAX_MODEL_BYTES = 20 * 1024 * 1024
const MAX_RUN_BYTES = 10 * 1024 * 1024

const join = (base: string, p: string) => `${base.replace(/\/$/, '')}/${p}`
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)

export async function fetchCatalog(base: string): Promise<Catalog> {
  const res = await fetch(join(base, 'models/catalog.json'))
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error('The model catalog is not published with this build.')
  const parsed = catalogSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error('The model catalog does not follow the expected format (catalog/1).')
  return parsed.data
}

async function fetchBytes(base: string, path: string, max: number): Promise<ArrayBuffer> {
  const res = await fetch(join(base, path))
  if (!res.ok) throw new Error(`Could not download ${baseName(path)} (HTTP ${res.status}).`)
  const buf = await res.arrayBuffer()
  if (buf.byteLength > max) throw new Error(`${baseName(path)} is larger than the allowed size.`)
  return buf
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Downloads the ONNX, checks it is the file the catalog promises, and gives it to the validated policy loader. */
export async function loadCatalogModel(base: string, entry: CatalogEntry): Promise<void> {
  const buf = await fetchBytes(base, entry.onnx, MAX_MODEL_BYTES)
  if ((await sha256Hex(buf)) !== entry.sha256) throw new Error(`The downloaded ${baseName(entry.onnx)} does not match the sha256 in the catalog, so it was not loaded.`)
  useByo.getState().actions.loadPolicy(new File([buf], baseName(entry.onnx), { type: 'application/octet-stream' }))
}

/** Downloads the entry's official run.json for a level and gives it to the run loader (schema check, then re-simulation). */
export async function loadCatalogRun(base: string, entry: CatalogEntry, level: RunLevel): Promise<void> {
  const path = entry.runs[level]
  if (!path) throw new Error(`${entry.name} has no ${level} run in this build.`)
  const buf = await fetchBytes(base, path, MAX_RUN_BYTES)
  useByo.getState().actions.loadRun(new File([buf], baseName(path), { type: 'application/json' }))
}

// ------------------------------------------------------------------------------------------------ store and hook

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'
interface CatalogState {
  status: Status
  models: CatalogEntry[]
  error: string | null
  /** what is being downloaded right now, "<id>:model" or "<id>:<level>" (one at a time: no double clicks) */
  busy: string | null
  base: string | null
  ensure: (base: string) => Promise<void>
}

const useCatalogStore = create<CatalogState>((set, get) => ({
  status: 'idle',
  models: [],
  error: null,
  busy: null,
  base: null,
  ensure: async (base) => {
    const s = get()
    if (s.base === base && (s.status === 'loading' || s.status === 'ready')) return
    set({ status: 'loading', base, error: null })
    try {
      const c = await fetchCatalog(base)
      set({ status: 'ready', models: c.models })
    } catch (e) {
      set({ status: 'unavailable', models: [], error: e instanceof Error ? e.message : String(e) })
    }
  },
}))

export interface ModelCatalog {
  status: 'loading' | 'ready' | 'unavailable'
  models: CatalogEntry[]
  error: string | null
  /** "<id>:model" or "<id>:<level>" while a download is in flight, else null */
  busy: string | null
  /** Loads the entry's ONNX through the validated loader (same as a drop). Rejects with a readable message. */
  loadModel: (id: string) => Promise<void>
  /** Loads the entry's official run.json for the level (default L1): re-simulation follows. */
  loadBenchmark: (id: string, level?: RunLevel) => Promise<void>
}

/**
 * Ready-made models for the lab and for the "Who drives?" selector. Fetches the catalog once the dataset is known.
 * Errors from loadModel/loadBenchmark are returned as rejections so the caller can show them next to the button;
 * validation errors of the file itself appear where a dropped file's errors do (useByo().policy.error / run.error).
 */
export function useModelCatalog(): ModelCatalog {
  const base = useApp((s) => s.dataset?.base ?? null)
  const status = useCatalogStore((s) => s.status)
  const models = useCatalogStore((s) => s.models)
  const error = useCatalogStore((s) => s.error)
  const busy = useCatalogStore((s) => s.busy)
  useEffect(() => {
    if (base) void useCatalogStore.getState().ensure(base)
  }, [base])

  const run = async (key: string, entryId: string, job: (b: string, e: CatalogEntry) => Promise<void>) => {
    const st = useCatalogStore.getState()
    const entry = st.models.find((m) => m.id === entryId)
    if (!st.base || !entry) throw new Error('That model is not in the catalog.')
    if (st.busy) return
    useCatalogStore.setState({ busy: key })
    try {
      await job(st.base, entry)
    } finally {
      useCatalogStore.setState({ busy: null })
    }
  }
  return {
    status: status === 'idle' ? 'loading' : status,
    models,
    error,
    busy,
    loadModel: (id) => run(`${id}:model`, id, (b, e) => loadCatalogModel(b, e)),
    loadBenchmark: (id, level = 'L1') => run(`${id}:${level}`, id, (b, e) => loadCatalogRun(b, e, level)),
  }
}
