import { describe, expect, it } from 'vitest'
import { INITIAL, keyAction, pickWaypoints, reduce, tourRequested } from './machine'

describe('tour step machine', () => {
  const n = 6
  it('starts at step 0 and is inactive until started', () => {
    expect(INITIAL).toEqual({ active: false, index: 0 })
    expect(reduce(INITIAL, { type: 'start' }, n)).toEqual({ active: true, index: 0 })
  })
  it('ignores next/back while inactive', () => {
    expect(reduce(INITIAL, { type: 'next' }, n)).toEqual(INITIAL)
    expect(reduce(INITIAL, { type: 'back' }, n)).toEqual(INITIAL)
  })
  it('moves forward and back inside bounds', () => {
    let s = reduce(INITIAL, { type: 'start' }, n)
    s = reduce(s, { type: 'next' }, n)
    expect(s.index).toBe(1)
    s = reduce(s, { type: 'back' }, n)
    expect(s.index).toBe(0)
    expect(reduce(s, { type: 'back' }, n).index).toBe(0)
  })
  it('finishes (exits) when next is pressed on the last step', () => {
    const s = { active: true, index: n - 1 }
    expect(reduce(s, { type: 'next' }, n)).toEqual({ active: false, index: 0 })
  })
  it('exit resets; goto clamps', () => {
    expect(reduce({ active: true, index: 3 }, { type: 'exit' }, n)).toEqual({ active: false, index: 0 })
    expect(reduce({ active: true, index: 1 }, { type: 'goto', index: 99 }, n).index).toBe(n - 1)
    expect(reduce({ active: true, index: 1 }, { type: 'goto', index: -4 }, n).index).toBe(0)
  })
  it('restarting from a step resets to the first one', () => {
    expect(reduce({ active: true, index: 4 }, { type: 'start' }, n)).toEqual({ active: true, index: 0 })
  })
})

describe('keyboard mapping', () => {
  const key = (k: string, extra: Partial<Parameters<typeof keyAction>[0]> = {}) => keyAction({ key: k, target: null, dialogOpen: false, ...extra })
  it('maps arrows and Escape', () => {
    expect(key('ArrowRight')).toBe('next')
    expect(key('ArrowLeft')).toBe('back')
    expect(key('Escape')).toBe('exit')
    expect(key('a')).toBeNull()
  })
  it('does not steal keys from sliders, inputs or open dialogs', () => {
    expect(key('ArrowRight', { target: { tagName: 'INPUT' } })).toBeNull()
    expect(key('ArrowLeft', { target: { tagName: 'DIV', role: 'slider' } })).toBeNull()
    expect(key('ArrowLeft', { target: { tagName: 'DIV', role: 'radio' } })).toBeNull()
    expect(key('Escape', { dialogOpen: true })).toBeNull()
    expect(key('ArrowRight', { dialogOpen: true })).toBeNull()
  })
})

describe('?tour parameter', () => {
  it('accepts 1 and true only', () => {
    expect(tourRequested('?tour=1')).toBe(true)
    expect(tourRequested('?data=jezero-v1&tour=true')).toBe(true)
    expect(tourRequested('?tour=0')).toBe(false)
    expect(tourRequested('')).toBe(false)
  })
})

describe('science stop choice', () => {
  const wps = [
    { x: 0, z: 0, sol: 1 },
    { x: 100, z: 0, sol: 5 },
    { x: 480, z: 90, sol: 20 },
    { x: 900, z: 900, sol: 40 },
  ]
  it('is deterministic: first waypoint as origin, the one closest to 500 m as destination', () => {
    const a = pickWaypoints(wps)
    expect(a?.origin.sol).toBe(1)
    expect(a?.destination.sol).toBe(20)
    expect(pickWaypoints(wps)).toEqual(a)
  })
  it('returns null with fewer than two waypoints', () => {
    expect(pickWaypoints([])).toBeNull()
    expect(pickWaypoints([wps[0]!])).toBeNull()
  })
})

describe('step list', () => {
  it('STEP_COUNT matches the steps defined in steps.ts', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./steps.ts', import.meta.url), 'utf8')
    const { STEP_COUNT } = await import('./step-count')
    expect((src.match(/^ {4}id: '/gm) ?? []).length).toBe(STEP_COUNT)
  })
})
