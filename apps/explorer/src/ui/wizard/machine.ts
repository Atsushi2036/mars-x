/**
 * "Plan a route" wizard: a pure state machine (no React, no stores).
 *
 *   start -> goal -> who -> (options, astronaut only, skippable) -> review -> journey (Watch, minimal UI)
 *
 * Start and goal are map taps; the others are panel steps. Back walks the same line in reverse until the journey begins;
 * Exit from the journey returns to review. A step that was already done can be revisited with `goto`.
 */

export type WizardStep = 'start' | 'goal' | 'who' | 'options' | 'review'
export type WizardProfile = 'astronaut' | 'rover-rtg' | 'rover-solar'

export interface WizardState {
  active: boolean
  step: WizardStep
  /** the Watch is running with the minimal interface */
  journey: boolean
}

export interface WizardCtx {
  hasOrigin: boolean
  hasDestination: boolean
  profile: WizardProfile
}

export type WizardEvent =
  | { type: 'begin' }
  | { type: 'originPlaced' }
  | { type: 'destinationPlaced' }
  /** both endpoints appeared at once (sample route, science stop, guided tour) */
  | { type: 'endpointsSet' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'back' }
  | { type: 'goto'; step: WizardStep }
  | { type: 'cancel' }
  | { type: 'go' }
  | { type: 'exit' }

export const INITIAL: WizardState = { active: false, step: 'start', journey: false }

/** Steps shown in the stepper: Options only exists for the astronaut. */
export function stepsFor(profile: WizardProfile): WizardStep[] {
  return profile === 'astronaut' ? ['start', 'goal', 'who', 'options', 'review'] : ['start', 'goal', 'who', 'review']
}

export const STEP_LABEL: Record<WizardStep, string> = { start: 'Start', goal: 'Goal', who: 'Who', options: 'Options', review: 'Review' }

/** A step can be opened when the data it needs exists (start always; goal needs a start; the rest need both). */
export function canGoto(step: WizardStep, ctx: WizardCtx): boolean {
  if (!stepsFor(ctx.profile).includes(step)) return false
  if (step === 'start') return true
  if (step === 'goal') return ctx.hasOrigin
  return ctx.hasOrigin && ctx.hasDestination
}

/** True while the next tap on the map is an endpoint of the route. */
export function isPicking(s: WizardState): boolean {
  return s.active && !s.journey && (s.step === 'start' || s.step === 'goal')
}

export function reduce(s: WizardState, e: WizardEvent, ctx: WizardCtx): WizardState {
  if (e.type === 'begin') return { active: true, step: 'start', journey: false }
  if (!s.active) return s
  if (e.type === 'cancel') return INITIAL
  if (s.journey) {
    if (e.type === 'exit') return { ...s, journey: false, step: 'review' }
    return s
  }
  switch (e.type) {
    case 'originPlaced':
      return s.step === 'start' ? { ...s, step: 'goal' } : s
    case 'destinationPlaced':
      return s.step === 'goal' ? { ...s, step: 'who' } : s
    case 'endpointsSet':
      return s.step === 'start' || s.step === 'goal' ? { ...s, step: 'who' } : s
    case 'next':
      if (s.step === 'who') return { ...s, step: ctx.profile === 'astronaut' ? 'options' : 'review' }
      if (s.step === 'options') return { ...s, step: 'review' }
      return s
    case 'skip':
      return s.step === 'options' ? { ...s, step: 'review' } : s
    case 'back':
      switch (s.step) {
        case 'start':
          return INITIAL
        case 'goal':
          return { ...s, step: 'start' }
        case 'who':
          return { ...s, step: 'goal' }
        case 'options':
          return { ...s, step: 'who' }
        case 'review':
          return { ...s, step: ctx.profile === 'astronaut' ? 'options' : 'who' }
      }
      return s
    case 'goto':
      return canGoto(e.step, ctx) ? { ...s, step: e.step } : s
    case 'go':
      return s.step === 'review' && ctx.hasOrigin && ctx.hasDestination ? { ...s, journey: true } : s
    default:
      return s
  }
}

/** Mission time as one short number and a unit: "52 min", "3.9 h". */
export function missionTimeParts(seconds: number): { value: string; unit: string } {
  const min = seconds / 60
  if (min < 90) return { value: String(Math.max(1, Math.round(min))), unit: 'min' }
  return { value: (min / 60).toFixed(1), unit: 'h' }
}
