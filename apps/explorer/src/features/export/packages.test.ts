import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fmtSize, packageUrl, parseExportIndex, scenarioName } from './packages'

const real = path.resolve(import.meta.dirname, '../../../../../data/processed/jezero-v1/export/index.json')

describe('export index', () => {
  it.skipIf(!(() => { try { readFileSync(real); return true } catch { return false } })())('parses the real index.json', () => {
    const idx = parseExportIndex(JSON.parse(readFileSync(real, 'utf8')))
    expect(idx.packages.length).toBeGreaterThan(0)
    for (const p of idx.packages) expect(p.gravity).toBeCloseTo(3.694, 3)
  })
  const ok = { schema: 'export-index/1', datasetId: 'jezero-v1', packages: [{ scenarioId: 'jezero-v1/l1/rtg-geometry', zip: 'a.zip', bytes: 10, sha256: 'a'.repeat(64), gravity: 3.694 }] }
  it('accepts a minimal valid index', () => {
    expect(parseExportIndex(ok).packages[0]!.zip).toBe('a.zip')
  })
  it('rejects a path in the file name (no traversal out of the export folder)', () => {
    for (const zip of ['../x.zip', 'a/b.zip', '/etc/passwd', 'a.exe', 'https://evil.example/a.zip']) {
      expect(() => parseExportIndex({ ...ok, packages: [{ ...ok.packages[0], zip }] })).toThrow()
    }
  })
  it('rejects a malformed hash and another schema', () => {
    expect(() => parseExportIndex({ ...ok, packages: [{ ...ok.packages[0], sha256: 'xyz' }] })).toThrow()
    expect(() => parseExportIndex({ ...ok, schema: 'export-index/2' })).toThrow()
  })
  it('formats names, sizes and urls', () => {
    expect(scenarioName('jezero-v1/l2/solar-clear')).toBe('L2 · Solar rover, clear sol')
    expect(scenarioName('x/y')).toBe('x/y')
    expect(fmtSize(11140292)).toBe('10.6 MB')
    expect(packageUrl('/data/jezero-v1', { zip: 'a.zip' })).toBe('/data/jezero-v1/export/a.zip')
  })
})
