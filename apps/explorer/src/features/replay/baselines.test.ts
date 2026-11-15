import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BASELINES, baselineRow, loadBaselines, parseBaseline } from './baselines'

const dir = path.resolve(import.meta.dirname, '../../../../../bench/jezero-v1/baselines')
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))

describe('published baselines', () => {
  it('parse the real scorecards and expose the level rows', () => {
    for (const b of BASELINES) {
      const card = parseBaseline(read(b.file))
      for (const level of ['L1', 'L2', 'L3'] as const) {
        const row = baselineRow(b, card, level)!
        expect(row.n).toBeGreaterThan(0)
        expect(row.ci[0]).toBeLessThanOrEqual(row.success)
        expect(row.ci[1]).toBeGreaterThanOrEqual(row.success)
      }
    }
  })
  it('A* beats random on the nominal level', () => {
    const a = baselineRow(BASELINES[0], parseBaseline(read('astar.scorecard.json')), 'L1')!
    const r = baselineRow(BASELINES[2], parseBaseline(read('random.scorecard.json')), 'L1')!
    expect(a.success).toBeGreaterThan(r.success)
  })
  it('rejects a file that is not a scorecard', () => {
    expect(() => parseBaseline({ schemaVersion: 'run/1' })).toThrow()
  })
  it('tolerates missing files and says so when none is available', async () => {
    const none = await loadBaselines('/x', undefined, async () => new Response('nope', { status: 404 }))
    expect(none.status).toBe('unavailable')
    const some = await loadBaselines('/x', undefined, async (u) =>
      String(u).endsWith('astar.scorecard.json')
        ? new Response(JSON.stringify(read('astar.scorecard.json')), { headers: { 'content-type': 'application/json' } })
        : new Response('nope', { status: 404 }),
    )
    expect(some.status === 'ready' && Object.keys(some.cards)).toEqual(['astar'])
  })
})
