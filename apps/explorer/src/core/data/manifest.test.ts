import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

const root = path.resolve(import.meta.dirname, '../../..')
const candidates = [
  path.resolve(root, '../../data/processed/jezero-v1/manifest.json'),
  path.resolve(root, 'public/data/synthetic/manifest.json'),
]

describe('manifest contract', () => {
  for (const file of candidates) {
    const name = path.relative(path.resolve(root, '../..'), file)
    it.skipIf(!fs.existsSync(file))(`parses ${name}`, () => {
      const m = parseManifest(JSON.parse(fs.readFileSync(file, 'utf8')))
      const elev = m.layers.find((l) => l.kind === 'elevation' && l.gridId === m.grid.id)!
      expect(elev.encoding.dtype).toBe('uint16')
      expect(elev.bytes).toBe(m.grid.width * m.grid.height * 2)
      expect(m.grid.transform[0]).toBe(m.grid.resM)
      expect(m.grid.transform[4]).toBe(-m.grid.resM) // north-up, rows grow south
    })
  }

  it('rejects a missing required key and a wrong type (drift that would break terrain must fail loudly)', () => {
    const f = candidates.find((c) => fs.existsSync(c))
    if (!f) return
    const m = JSON.parse(fs.readFileSync(f, 'utf8'))
    const bad = structuredClone(m)
    delete bad.crs.center
    expect(() => parseManifest(bad)).toThrow(/Invalid manifest/)
    const bad2 = structuredClone(m)
    bad2.grid.width = 'wide'
    expect(() => parseManifest(bad2)).toThrow(/Invalid manifest/)
  })

  it('ignores unknown additional keys (forward compatible)', () => {
    const f = candidates.find((c) => fs.existsSync(c))
    if (!f) return
    const m = JSON.parse(fs.readFileSync(f, 'utf8'))
    m.surprise = 1
    expect(() => parseManifest(m)).not.toThrow()
  })

  it('rejects a layer pointing at an undeclared grid', () => {
    const f = candidates.find((c) => fs.existsSync(c))
    if (!f) return
    const m = JSON.parse(fs.readFileSync(f, 'utf8'))
    m.layers[0].gridId = 'nope'
    expect(() => parseManifest(m)).toThrow(/gridId/)
  })
})
