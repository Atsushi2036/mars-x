import { describe, expect, it } from 'vitest'
import { FLAG_BUMP } from '@/intelligence/lab/qlearn'
import { ACTION_ARROWS, cividis, exploreShare, frameAt, normalizeValues, planBatch, stepMsFor, successRate, WATCH_SPEEDS, type SampleLike } from './watch'

const sample = (over: Partial<SampleLike> = {}): SampleLike => ({
  start: 10,
  cells: [11, 12, 12, 13],
  reward: [-1, -1, -5, 100],
  flags: [0, 0, FLAG_BUMP, 0],
  outcome: 'goal',
  ...over,
})

describe('planBatch', () => {
  it('slow shows every episode one by one; fast and turbo batch and sample the last', () => {
    expect(planBatch('slow')).toMatchObject({ batch: 1, sampleEvery: 1 })
    expect(planBatch('fast').batch).toBeGreaterThan(1)
    expect(planBatch('turbo').batch).toBeGreaterThan(planBatch('fast').batch)
    expect(WATCH_SPEEDS.slow.stepMs).toBeGreaterThan(WATCH_SPEEDS.fast.stepMs)
    expect(WATCH_SPEEDS.fast.stepMs).toBeGreaterThan(WATCH_SPEEDS.turbo.stepMs)
  })
})

describe('stepMsFor', () => {
  it('keeps the speed for short episodes and speeds up long ones so no episode lasts more than ~10 s', () => {
    expect(stepMsFor('slow', 40)).toBe(WATCH_SPEEDS.slow.stepMs)
    const long = stepMsFor('slow', 600)
    expect(long).toBeLessThan(WATCH_SPEEDS.slow.stepMs)
    expect(long * 600).toBeLessThanOrEqual(10_000)
    expect(stepMsFor('turbo', 600)).toBeGreaterThanOrEqual(4) // never faster than a frame can show
    expect(stepMsFor('slow', 0)).toBe(WATCH_SPEEDS.slow.stepMs)
  })
})

describe('frameAt', () => {
  it('starts on the start cell with nothing to show', () => {
    const f = frameAt(sample(), 0, 100)
    expect(f).toMatchObject({ step: 0, cell: 10, done: false, banner: null, flash: null })
    expect(f.floaters).toHaveLength(0)
  })

  it('moves one cell per step and leaves a trail', () => {
    const f = frameAt(sample(), 250, 100)
    expect(f.step).toBe(2)
    expect(f.cell).toBe(12)
    expect(f.trail).toEqual([10, 11, 12])
  })

  it('floats the step reward: red for a cost, green for a gain, "Hazard" for a bump', () => {
    const a = frameAt(sample(), 110, 100)
    expect(a.floaters[0]).toMatchObject({ tone: 'loss', text: '−1.0' })
    const b = frameAt(sample(), 310, 100)
    expect(b.floaters.find((x) => x.tone === 'hazard')?.text).toBe('Hazard −5')
    const g = frameAt(sample({ reward: [0.4, 0.4, 0.4, 0.4], flags: [0, 0, 0, 0] }), 110, 100)
    expect(g.floaters[0]).toMatchObject({ tone: 'gain', text: '+0.4' })
  })

  it('floaters fade out with age', () => {
    const f = frameAt(sample(), 110, 100, { floatMs: 500 })
    expect(f.floaters[0]!.age).toBeCloseTo(0.02, 1)
    expect(frameAt(sample(), 800, 100, { floatMs: 500 }).floaters.filter((x) => x.text === '−1.0')).toHaveLength(0)
  })

  it('ends with a green flash and the goal banner on success', () => {
    const f = frameAt(sample(), 450, 100, { endHoldMs: 1000 })
    expect(f.step).toBe(4)
    expect(f.flash).toMatchObject({ tone: 'goal' })
    expect(f.banner).toBe('+100 Goal')
    expect(f.done).toBe(false)
    expect(frameAt(sample(), 1500, 100, { endHoldMs: 1000 }).done).toBe(true)
  })

  it('ends grey with "Out of time" on a timeout', () => {
    const f = frameAt(sample({ outcome: 'timeout', reward: [-1, -1, -5, -1] }), 450, 100)
    expect(f.flash).toMatchObject({ tone: 'timeout' })
    expect(f.banner).toBe('Out of time')
  })

  it('an episode that stops on a bump flashes red with the hazard banner', () => {
    const f = frameAt(sample({ outcome: 'timeout', cells: [11, 11], reward: [-1, -5], flags: [0, FLAG_BUMP] }), 250, 100)
    expect(f.flash).toMatchObject({ tone: 'hazard' })
    expect(f.banner).toBe('Hazard −5')
  })

  it('handles an empty episode (already on the goal)', () => {
    const f = frameAt(sample({ cells: [], reward: [], flags: [] }), 10, 100)
    expect(f.done).toBe(false)
    expect(f.cell).toBe(10)
  })
})

describe('colours and glyphs', () => {
  it('cividis runs from dark blue to bright yellow, getting brighter', () => {
    const lum = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    let prev = -1
    for (let i = 0; i <= 10; i++) {
      const l = lum(cividis(i / 10))
      expect(l).toBeGreaterThan(prev)
      prev = l
    }
    expect(cividis(0)[2]).toBeGreaterThan(cividis(0)[0]) // blue end
    expect(cividis(1)[0]).toBeGreaterThan(cividis(1)[2]) // yellow end
    expect(cividis(-3)).toEqual(cividis(0))
    expect(cividis(9)).toEqual(cividis(1))
  })

  it('normalizeValues scales the visited cells to 0..1 and leaves the rest at -1', () => {
    const t = normalizeValues(new Float32Array([-10, 0, 5, 0]), new Uint8Array([1, 255, 2, 255]))
    expect(Array.from(t)).toEqual([0, -1, 1, -1])
    expect(Array.from(normalizeValues(new Float32Array([3, 3]), new Uint8Array([1, 1])))).toEqual([0.5, 0.5])
  })

  it('has one arrow per move', () => {
    expect(ACTION_ARROWS).toHaveLength(8)
    expect(new Set(ACTION_ARROWS.map((a) => a.join())).size).toBe(8)
  })
})

describe('counters', () => {
  it('successRate looks at the last 100 episodes', () => {
    const curve = Array.from({ length: 150 }, (_, i) => ({ episode: i + 1, reachedGoal: i >= 50, epsilon: 0.5, ret: 0, steps: 1 }))
    expect(successRate(curve)).toBe(1)
    expect(successRate([])).toBeNull()
    expect(successRate(curve.slice(0, 50))).toBe(0)
  })

  it('exploreShare is epsilon, clamped', () => {
    expect(exploreShare(0.37)).toBeCloseTo(0.37)
    expect(exploreShare(2)).toBe(1)
    expect(exploreShare(-1)).toBe(0)
  })
})
