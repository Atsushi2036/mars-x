import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useByo } from './byo-store'
import { catalogSchema, fetchCatalog, loadCatalogModel, loadCatalogRun, type CatalogEntry } from './model-catalog'

const repo = resolve(__dirname, '../../../../..')
const read = (p: string) => readFileSync(resolve(repo, p))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const catalogJson = JSON.parse(read('models/jezero-v1/catalog.json').toString('utf8'))

// where each catalog path lives in the repo (the build copies these into dist/data/jezero-v1/)
const FILES: Record<string, string> = {
  'models/policy.onnx': 'models/jezero-v1/policy.onnx',
  'models/policy-card.json': 'models/jezero-v1/policy-card.json',
  'models/examples/my-first-model/my-model.onnx': 'examples/my-first-model/my-model.onnx',
  'models/examples/my-first-model/my-model.card.json': 'examples/my-first-model/my-model.card.json',
  'models/examples/my-first-model/my-model.L1.run.json': 'examples/my-first-model/my-model.L1.run.json',
  'models/examples/my-first-model/my-model.L2.run.json': 'examples/my-first-model/my-model.L2.run.json',
}

describe('catalog.json', () => {
  it('follows the schema', () => {
    const c = catalogSchema.parse(catalogJson)
    expect(c.models.map((m) => m.id)).toEqual(['ppo-reference', 'my-first-model'])
  })

  it('rejects paths that leave the dataset folder and unknown kinds', () => {
    const bad = (patch: object) => catalogSchema.safeParse({ ...catalogJson, models: [{ ...catalogJson.models[0], ...patch }] }).success
    expect(bad({})).toBe(true)
    expect(bad({ onnx: '../../etc/passwd' })).toBe(false)
    expect(bad({ onnx: 'https://evil.example/m.onnx' })).toBe(false)
    expect(bad({ onnx: '/abs/path.onnx' })).toBe(false)
    expect(bad({ kind: 'hacked' })).toBe(false)
    expect(bad({ sha256: 'abc' })).toBe(false)
  })

  it('every entry points at files that exist, and its sha256 is the real one (also in its model card)', () => {
    for (const m of catalogSchema.parse(catalogJson).models) {
      const onnx = read(FILES[m.onnx]!)
      expect(sha(onnx), m.id).toBe(m.sha256)
      const card = JSON.parse(read(FILES[m.card]!).toString('utf8'))
      expect(card.onnxSha256, m.id).toBe(m.sha256)
      for (const p of Object.values(m.runs)) expect(FILES[p!], `${m.id} ${p}`).toBeTruthy()
    }
  })

  it('the official numbers match the run files and the scorecard the team published', () => {
    const ex = catalogSchema.parse(catalogJson).models.find((m) => m.id === 'my-first-model')!
    const score = JSON.parse(read('examples/my-first-model/my-model.scorecard.json').toString('utf8'))
    for (const lvl of ['L1', 'L2'] as const) {
      const row = score.verdict.levels.find((l: { level: string }) => l.level === lvl).metrics
      expect(ex.official[lvl]!.n).toBe(row.n)
      expect(ex.official[lvl]!.success).toBeCloseTo(row.success, 2)
    }
    expect(ex.passesL1).toBe(false)
    const ppo = JSON.parse(read('bench/jezero-v1/baselines/ppo.scorecard.json').toString('utf8'))
    const ref = catalogSchema.parse(catalogJson).models.find((m) => m.id === 'ppo-reference')!
    expect(ref.official.L1!.success).toBeCloseTo(ppo.verdict.levels[0].metrics.success, 3)
    expect(ref.official.L2!.success).toBeCloseTo(ppo.verdict.levels[1].metrics.success, 3)
  })

  it('an entry that did not pass L1 says so honestly (passesL1 agrees with the 80 % threshold)', () => {
    for (const m of catalogSchema.parse(catalogJson).models) expect(m.passesL1).toBe(m.official.L1!.success >= 0.8)
  })
})

function mockFetch(files: Record<string, Buffer>, overrides: Record<string, Buffer> = {}) {
  return vi.fn(async (url: string) => {
    const key = Object.keys(files).find((k) => url.endsWith('/' + k) || url.endsWith(k))
    if (url.endsWith('/models/catalog.json')) return new Response(JSON.stringify(catalogJson), { headers: { 'content-type': 'application/json' } })
    if (!key) return new Response('nope', { status: 404 })
    return new Response(new Uint8Array(overrides[key] ?? files[key]!))
  })
}
const allFiles = () => Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, read(v)]))

afterEach(() => {
  vi.unstubAllGlobals()
  useByo.setState({ actions: { loadRun: () => undefined, closeRun: () => undefined, loadPolicy: () => undefined, unloadPolicy: () => undefined } })
})

describe('fetchCatalog', () => {
  it('reads and validates /models/catalog.json', async () => {
    vi.stubGlobal('fetch', mockFetch(allFiles()))
    const c = await fetchCatalog('/data/jezero-v1')
    expect(c.models).toHaveLength(2)
  })

  it('fails with a clear error when the file is missing or not the expected JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>spa fallback</html>', { headers: { 'content-type': 'text/html' } })))
    await expect(fetchCatalog('/data/jezero-v1')).rejects.toThrow(/catalog/i)
  })
})

describe('loading from the catalog goes through the same path as a drop', () => {
  const entry = (id: string): CatalogEntry => catalogSchema.parse(catalogJson).models.find((m) => m.id === id)!

  it('Load model hands a File with the real bytes to the validated policy loader', async () => {
    const loadPolicy = vi.fn()
    useByo.setState({ actions: { ...useByo.getState().actions, loadPolicy } })
    vi.stubGlobal('fetch', mockFetch(allFiles()))
    await loadCatalogModel('/data/jezero-v1', entry('my-first-model'))
    expect(loadPolicy).toHaveBeenCalledOnce()
    const file = loadPolicy.mock.calls[0]![0] as File
    expect(file.name).toBe('my-model.onnx')
    expect(sha(Buffer.from(await file.arrayBuffer()))).toBe(entry('my-first-model').sha256)
  })

  it('refuses a download whose sha256 differs from the catalog (nothing reaches the loader)', async () => {
    const loadPolicy = vi.fn()
    useByo.setState({ actions: { ...useByo.getState().actions, loadPolicy } })
    vi.stubGlobal('fetch', mockFetch(allFiles(), { 'models/examples/my-first-model/my-model.onnx': Buffer.from('tampered') }))
    await expect(loadCatalogModel('/data/jezero-v1', entry('my-first-model'))).rejects.toThrow(/sha256/i)
    expect(loadPolicy).not.toHaveBeenCalled()
  })

  it('See its benchmark hands the L1 run.json to the run loader (verification runs in its Worker)', async () => {
    const loadRun = vi.fn()
    useByo.setState({ actions: { ...useByo.getState().actions, loadRun } })
    vi.stubGlobal('fetch', mockFetch(allFiles()))
    await loadCatalogRun('/data/jezero-v1', entry('my-first-model'), 'L1')
    const file = loadRun.mock.calls[0]![0] as File
    expect(file.name).toBe('my-model.L1.run.json')
    expect(JSON.parse(await file.text()).suite.level).toBe('L1')
  })

  it('an entry without that run cannot load a benchmark', async () => {
    vi.stubGlobal('fetch', mockFetch(allFiles()))
    await expect(loadCatalogRun('/data/jezero-v1', entry('ppo-reference'), 'L1')).rejects.toThrow(/no L1 run/i)
  })
})
