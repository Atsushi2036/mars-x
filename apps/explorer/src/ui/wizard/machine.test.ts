import { describe, expect, it } from 'vitest'
import { canGoto, driverSummary, INITIAL, isPicking, missionTimeParts, reduce, stepsFor, type WizardCtx, type WizardEvent, type WizardState } from './machine'

const rover: WizardCtx = { hasOrigin: true, hasDestination: true, profile: 'rover-rtg', ai: false }
const roverAi: WizardCtx = { ...rover, ai: true }
const astro: WizardCtx = { ...rover, profile: 'astronaut' }
const astroAi: WizardCtx = { ...astro, ai: true }
const none: WizardCtx = { hasOrigin: false, hasDestination: false, profile: 'rover-rtg', ai: false }
const noneAi: WizardCtx = { ...none, ai: true }

function run(events: WizardEvent[], ctx: WizardCtx, from: WizardState = INITIAL): WizardState {
  return events.reduce((s, e) => reduce(s, e, ctx), from)
}
const E = (type: WizardEvent['type']): WizardEvent => ({ type }) as WizardEvent

describe('plan wizard machine: order of the steps', () => {
  it('does nothing until it begins', () => {
    expect(reduce(INITIAL, E('originPlaced'), none)).toEqual(INITIAL)
    expect(reduce(INITIAL, E('next'), rover)).toEqual(INITIAL)
  })

  it('decides who travels and who drives first, before any map tap', () => {
    const s = run([E('begin')], none)
    expect(s.step).toBe('who')
    expect(isPicking(s)).toBe(false)
    expect(run([E('next')], none, s).step).toBe('driver')
  })

  it('A* branch: who, driver, start, goal, review (no How step, no Options for a rover)', () => {
    let s = run([E('begin'), E('next'), E('next')], none)
    expect(s.step).toBe('start')
    expect(isPicking(s)).toBe(true)
    s = run([E('originPlaced')], none, s)
    expect(s.step).toBe('goal')
    s = run([E('destinationPlaced')], rover, s)
    expect(s.step).toBe('review')
    expect(stepsFor(rover)).toEqual(['who', 'driver', 'start', 'goal', 'review'])
  })

  it('AI branch: adds How (Guided or Free) between the driver and the map', () => {
    const s = run([E('begin'), E('next'), E('next')], noneAi)
    expect(s.step).toBe('how')
    expect(run([E('next')], noneAi, s).step).toBe('start')
    expect(stepsFor(roverAi)).toEqual(['who', 'driver', 'how', 'start', 'goal', 'review'])
  })

  it('astronaut gets the optional Options step after the goal, and Skip jumps over it', () => {
    const atGoal = run([E('begin'), E('next'), E('next'), E('originPlaced')], { ...astro, hasOrigin: false, hasDestination: false })
    const s = run([E('destinationPlaced')], astro, atGoal)
    expect(s.step).toBe('options')
    expect(run([E('skip')], astro, s).step).toBe('review')
    expect(run([E('next')], astro, s).step).toBe('review')
    expect(stepsFor(astroAi)).toEqual(['who', 'driver', 'how', 'start', 'goal', 'options', 'review'])
  })
})

describe('plan wizard machine: back, goto, points', () => {
  it('goes back one step at a time along the same line (rover, A*)', () => {
    const atReview = run([E('begin'), E('next'), E('next'), E('endpointsSet')], rover)
    expect(atReview.step).toBe('review')
    const steps: string[] = []
    let s = atReview
    for (let i = 0; i < 5; i++) {
      s = run([E('back')], rover, s)
      steps.push(s.active ? s.step : 'closed')
    }
    expect(steps).toEqual(['goal', 'start', 'driver', 'who', 'closed'])
  })

  it('with an AI, Back from Start returns to How; astronaut review goes back through Options', () => {
    const atStart = run([E('begin'), E('next'), E('next'), E('next')], roverAi)
    expect(atStart.step).toBe('start')
    expect(run([E('back')], roverAi, atStart).step).toBe('how')
    const atReview = run([E('begin'), E('next'), E('next'), E('next'), E('endpointsSet'), E('next')], astroAi)
    expect(atReview.step).toBe('review')
    expect(run([E('back')], astroAi, atReview).step).toBe('options')
  })

  it('treats a pair of endpoints that appear together as done, only while picking', () => {
    const picking = run([E('begin'), E('next'), E('next')], rover)
    expect(run([E('endpointsSet')], rover, picking).step).toBe('review')
    // still choosing who/driver: late endpoint events change nothing
    const early = run([E('begin')], rover)
    expect(run([E('endpointsSet'), E('originPlaced'), E('destinationPlaced')], rover, early).step).toBe('who')
  })

  it('only opens a step whose data exists; the first steps are always open', () => {
    for (const st of ['who', 'driver', 'start'] as const) expect(canGoto(st, none)).toBe(true)
    expect(canGoto('how', none)).toBe(false)
    expect(canGoto('how', noneAi)).toBe(true)
    expect(canGoto('goal', none)).toBe(false)
    expect(canGoto('goal', { ...none, hasOrigin: true })).toBe(true)
    expect(canGoto('review', { ...none, hasOrigin: true })).toBe(false)
    expect(canGoto('options', rover)).toBe(false)
    expect(canGoto('options', astro)).toBe(true)
  })

  it('from Review the driver can be changed with the stepper and the points are kept (they live in the mission store)', () => {
    const atReview = run([E('begin'), E('next'), E('next'), E('endpointsSet')], rover)
    const back = run([{ type: 'goto', step: 'driver' }], rover, atReview)
    expect(back.step).toBe('driver')
    // the driver became an AI: the How step now exists and is reachable, Review is still reachable
    expect(run([{ type: 'goto', step: 'how' }], roverAi, back).step).toBe('how')
    expect(run([{ type: 'goto', step: 'review' }], roverAi, back).step).toBe('review')
  })
})

describe('plan wizard machine: journey', () => {
  it('starts only from review with both endpoints, and Exit returns to review', () => {
    const atReview = run([E('begin'), E('next'), E('next'), E('endpointsSet')], rover)
    expect(run([E('go')], none, atReview).journey).toBe(false)
    const going = run([E('go')], rover, atReview)
    expect(going.journey).toBe(true)
    expect(run([E('back'), E('next'), { type: 'goto', step: 'who' }], rover, going)).toEqual(going)
    expect(run([E('exit')], rover, going)).toEqual({ active: true, step: 'review', journey: false })
  })

  it('cancel closes it from anywhere', () => {
    const s = run([E('begin'), E('next')], rover)
    expect(run([E('cancel')], rover, s)).toEqual(INITIAL)
  })
})

describe('summary and mission time', () => {
  it('one line for Review', () => {
    expect(driverSummary('astar', 'guided', 'Rover RTG')).toBe('A* plan · Rover RTG')
    expect(driverSummary('reference', 'guided', 'Rover RTG')).toBe('Reference AI · Guided · Rover RTG')
    expect(driverSummary('user', 'free', 'Astronaut')).toBe('Your model · Free · Astronaut')
    expect(driverSummary('catalog:x', 'free', 'Rover solar', [{ id: 'x', kind: 'example', name: 'Ex' }])).toBe('Example model · Free · Rover solar')
  })
  it('gives one short number and a unit', () => {
    expect(missionTimeParts(0)).toEqual({ value: '1', unit: 'min' })
    expect(missionTimeParts(52 * 60)).toEqual({ value: '52', unit: 'min' })
    expect(missionTimeParts(429 / 0.042)).toEqual({ value: '2.8', unit: 'h' })
  })
})
