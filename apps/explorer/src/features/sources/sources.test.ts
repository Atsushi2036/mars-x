import { describe, expect, it } from 'vitest'
import type { Manifest } from '@/core/data/manifest'
import { baseTitle, doiUrl, fmtRes, groupSources, safeHttps } from './sources'
import { headlines, validationSchema } from './validation'

const src = (title: string, doi: string | null, extra: object = {}) => ({ title, doi, url: 'https://example.org/x', license: 'CC0-1.0', attribution: `credit for ${title}`, retrievedAt: '2026-11-14', ...extra })
const layer = (id: string, kind: string, origin: string, source: ReturnType<typeof src>, gridId: string | null) => ({ id, kind, origin, source, gridId }) as unknown as Manifest['layers'][number]

const manifest = {
  grids: { dem: { resM: 1 }, plan: { resM: 2 }, ortho: { resM: 0.25 } },
  layers: [
    layer('height', 'elevation', 'derived', src('DTM mosaic', '10.5066/P9REJ9JN'), 'dem'),
    layer('slope', 'slope', 'derived', src('DTM mosaic -> derived by the marsx pipeline', '10.5066/P9REJ9JN'), 'dem'),
    layer('plan_slope', 'slope', 'derived', src('DTM mosaic -> derived by the marsx pipeline', '10.5066/P9REJ9JN'), 'plan'),
    layer('ortho', 'orthoimage', 'observed', src('Ortho mosaic', '10.5066/P9QJDP48'), 'ortho'),
    layer('traverse', 'vector', 'observed', src('Traverse', null), null),
  ],
} as unknown as Manifest

describe('source groups from the manifest', () => {
  const g = groupSources(manifest)
  it('merges derived layers into the product they come from and keeps the manifest text', () => {
    expect(g.map((x) => x.title)).toEqual(['DTM mosaic', 'Ortho mosaic', 'Traverse'])
    expect(g[0]!.layers).toEqual(['height', 'slope', 'plan_slope'])
    expect(g[0]!.attribution).toBe('credit for DTM mosaic')
    expect(g[0]!.doi).toBe('10.5066/P9REJ9JN')
  })
  it('reports the finest resolution among the layers and No data when there is no grid', () => {
    expect(g[0]!.resM).toBe(1)
    expect(g[1]!.resM).toBe(0.25)
    expect(fmtRes(g[1]!.resM)).toBe('25 cm/px')
    expect(fmtRes(g[2]!.resM)).toBe('No data')
  })
  it('marks observed products as measured', () => {
    expect(g[1]!.provenance).toBe('measured')
    expect(g[0]!.provenance).toBe('derived')
  })
  it('strips the pipeline suffix', () => {
    expect(baseTitle('A -> derived by the marsx pipeline')).toBe('A')
  })
})

describe('links', () => {
  it('only builds https DOI links from real DOIs', () => {
    expect(doiUrl('10.5066/P9REJ9JN')).toBe('https://doi.org/10.5066/P9REJ9JN')
    expect(doiUrl('doi:10.5281/zenodo.5575824')).toBe('https://doi.org/10.5281/zenodo.5575824')
    expect(doiUrl('javascript:alert(1)')).toBeNull()
    expect(doiUrl(null)).toBeNull()
  })
  it('refuses non-https URLs', () => {
    expect(safeHttps('http://a.org')).toBeNull()
    expect(safeHttps('javascript:alert(1)')).toBeNull()
    expect(safeHttps('https://a.org/x')).toBe('https://a.org/x')
  })
})

describe('validation headlines', () => {
  const stat = (p: number, mae: number) => ({ n: 147, pearson: p, mae, bias: 0.0025, rmse: mae * 1.5 })
  const rep = validationSchema.parse({
    datasetId: 'jezero-v1',
    generatedAt: '2026-11-14T23:21:18Z',
    alignmentDemOrtho: { method: 'ncc', globalShiftPx: { magnitude: 0.6477 }, shiftPxP95: 1.368, validPatches: 13, patches: 16, globalCorrelation: 0.3855, pixelSizeM: 1 },
    demHeightAtWaypoints_vs_published_elevGeoid: stat(0.99999905, 0.02689),
    slopeVsRoverTilt: { note: 'n', tiltDeg_vs_demSlope1m: stat(0.8408, 1.902), tiltDeg_vs_demSlopeSmoothed1p5m: stat(0.9072, 1.4136) },
    notes: [],
  })
  const h = headlines(rep)
  it('reads the three headline numbers from the report', () => {
    expect(h[0]!.big).toBe('r = 1.00000')
    expect(h[0]!.lines[0]).toEqual(['Mean absolute error', '2.7 cm'])
    expect(h[1]!.big).toBe('r = 0.84')
    expect(h[1]!.bigLabel).toContain('0.91')
    expect(h[1]!.lines[0]![1]).toBe('1.9° (1.4° smoothed)')
    expect(h[2]!.big).toBe('0.65 px')
  })
  it('keeps each caveat next to its number', () => {
    expect(h.every((x) => x.caveat.length > 20)).toBe(true)
  })
  it('rejects a malformed report instead of showing partial numbers', () => {
    expect(validationSchema.safeParse({ datasetId: 'x' }).success).toBe(false)
  })
})
