import { describe, expect, it } from 'vitest'
import { canGoto, INITIAL, isPicking, missionTimeParts, reduce, stepsFor, type WizardCtx, type WizardEvent, type WizardState } from './machine'

const rover: WizardCtx = { hasOrigin: true, hasDestination: true, profile: 'rover-rtg' }
const astro: WizardCtx = { ...rover, profile: 'astronaut' }
const none: WizardCtx = { hasOrigin: false, hasDestination: false, profile: 'rover-rtg' }

function run(events: WizardEvent[], ctx: WizardCtx, from: WizardState = INITIAL): WizardState {
  return events.reduce((s, e) => reduce(s, e, ctx), from)
}

describe('plan wizard machine', () => {
  it('does nothing until it begins', () => {
    expect(reduce(INITIAL, { type: 'originPlaced' }, none)).toEqual(INITIAL)
    expect(reduce(INITIAL, { type: 'next' }, rover)).toEqual(INITIAL)
  })

  it('walks start, goal, who, review for a rover (options are skipped)', () => {
    let s = run([{ type: 'begin' }], none)
    expect(s.step).toBe('start')
    s = run([{ type: 'originPlaced' }], none, s)
    expect(s.step).toBe('goal')
    s = run([{ type: 'destinationPlaced' }], rover, s)
    expect(s.step).toBe('who')
    s = run([{ type: 'next' }], rover, s)
    expect(s.step).toBe('review')
  })

  it('adds the optional options step for the astronaut, and Skip jumps over it', () => {
    const s = run([{ type: 'begin' }, { type: 'originPlaced' }, { type: 'destinationPlaced' }, { type: 'next' }], astro)
    expect(s.step).toBe('options')
    expect(run([{ type: 'skip' }], astro, s).step).toBe('review')
    expect(run([{ type: 'next' }], astro, s).step).toBe('review')
    expect(stepsFor('astronaut')).toContain('options')
    expect(stepsFor('rover-solar')).not.toContain('options')
  })

  it('goes back one step at a time, and back from the start cancels', () => {
    const atReview = run([{ type: 'begin' }, { type: 'endpointsSet' }, { type: 'next' }], rover)
    expect(atReview.step).toBe('review')
    const back1 = run([{ type: 'back' }], rover, atReview)
    expect(back1.step).toBe('who')
    expect(run([{ type: 'back' }], rover, back1).step).toBe('goal')
    expect(run([{ type: 'back' }, { type: 'back' }, { type: 'back' }], rover, back1).active).toBe(false)
    // astronaut: review goes back through options
    const a = run([{ type: 'begin' }, { type: 'endpointsSet' }, { type: 'next' }, { type: 'next' }], astro)
    expect(run([{ type: 'back' }], astro, a).step).toBe('options')
  })

  it('treats a pair of endpoints that appear together (sample route, science stop, tour) as done', () => {
    expect(run([{ type: 'begin' }, { type: 'endpointsSet' }], rover).step).toBe('who')
    const s = run([{ type: 'begin' }, { type: 'originPlaced' }, { type: 'destinationPlaced' }, { type: 'next' }], rover)
    // already past the map steps: late endpoint events change nothing
    expect(run([{ type: 'endpointsSet' }, { type: 'originPlaced' }], rover, s).step).toBe('review')
  })

  it('only opens a step whose data exists', () => {
    expect(canGoto('start', none)).toBe(true)
    expect(canGoto('goal', none)).toBe(false)
    expect(canGoto('goal', { ...none, hasOrigin: true })).toBe(true)
    expect(canGoto('review', { ...none, hasOrigin: true })).toBe(false)
    expect(canGoto('options', rover)).toBe(false)
    expect(canGoto('options', astro)).toBe(true)
    const s = run([{ type: 'begin' }, { type: 'endpointsSet' }, { type: 'next' }], rover)
    expect(run([{ type: 'goto', step: 'start' }], rover, s).step).toBe('start')
    expect(run([{ type: 'goto', step: 'options' }], rover, s).step).toBe('review')
  })

  it('starts the journey only from review with both endpoints, and Exit returns to review', () => {
    const atWho = run([{ type: 'begin' }, { type: 'endpointsSet' }], rover)
    expect(run([{ type: 'go' }], rover, atWho).journey).toBe(false)
    const atReview = run([{ type: 'next' }], rover, atWho)
    expect(run([{ type: 'go' }], none, atReview).journey).toBe(false)
    const going = run([{ type: 'go' }], rover, atReview)
    expect(going.journey).toBe(true)
    // nothing but Exit (and cancel) moves while the journey runs
    expect(run([{ type: 'back' }, { type: 'next' }, { type: 'goto', step: 'start' }], rover, going)).toEqual(going)
    const out = run([{ type: 'exit' }], rover, going)
    expect(out).toEqual({ active: true, step: 'review', journey: false })
  })

  it('knows when the next map tap is an endpoint', () => {
    expect(isPicking(run([{ type: 'begin' }], none))).toBe(true)
    expect(isPicking(run([{ type: 'begin' }, { type: 'endpointsSet' }], rover))).toBe(false)
    expect(isPicking(INITIAL)).toBe(false)
  })

  it('cancel closes it from anywhere', () => {
    const s = run([{ type: 'begin' }, { type: 'endpointsSet' }, { type: 'next' }], rover)
    expect(run([{ type: 'cancel' }], rover, s)).toEqual(INITIAL)
  })
})

describe('missionTimeParts', () => {
  it('gives one short number and a unit', () => {
    expect(missionTimeParts(0)).toEqual({ value: '1', unit: 'min' })
    expect(missionTimeParts(52 * 60)).toEqual({ value: '52', unit: 'min' })
    expect(missionTimeParts(429 / 0.042)).toEqual({ value: '2.8', unit: 'h' })
  })
})
