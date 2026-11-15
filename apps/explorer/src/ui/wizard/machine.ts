/**
 * "Plan a route" wizard: a pure state machine (no React, no stores).
 *
 *   who -> driver -> (how, only for an AI driver) -> start -> goal -> (options, astronaut only) -> review -> journey
 *
 * Who travels and who drives come first, because they decide what the map taps mean: with the A* plan or a Guided AI the
 * route and its waypoints are previewed; with a Free AI only the goal matters. Start and goal are map taps; the others are
 * panel steps. Back walks the same line in reverse until the journey begins; Exit from the journey returns to review.
 * A step already done can be revisited with `goto` without losing the points.
 */

export type WizardStep = 'who' | 'driver' | 'how' | 'start' | 'goal' | 'options' | 'review'
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
  /** an AI (not the A* plan) drives: adds the "how it drives" step */
  ai: boolean
}

export type WizardEvent =
  | { type: 'begin' }
  | { type: 'originPlaced' }
  | { type: 'destinationPlaced' }
  /** both endpoints appeared at once (sample route, science stop, "keep A and B") */
  | { type: 'endpointsSet' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'back' }
  | { type: 'goto'; step: WizardStep }
  | { type: 'cancel' }
  | { type: 'go' }
  | { type: 'exit' }

export const INITIAL: WizardState = { active: false, step: 'who', journey: false }

/** Steps shown in the stepper: How only exists for an AI, Options only for the astronaut. */
export function stepsFor(ctx: Pick<WizardCtx, 'profile' | 'ai'>): WizardStep[] {
  return ['who', 'driver', ...(ctx.ai ? (['how'] as const) : []), 'start', 'goal', ...(ctx.profile === 'astronaut' ? (['options'] as const) : []), 'review']
}

export const STEP_LABEL: Record<WizardStep, string> = { who: 'Who', driver: 'Driver', how: 'How', start: 'Start', goal: 'Goal', options: 'Options', review: 'Review' }

/** A step can be opened when the data it needs exists (the first ones always; goal needs a start; the rest need both). */
export function canGoto(step: WizardStep, ctx: WizardCtx): boolean {
  if (!stepsFor(ctx).includes(step)) return false
  if (step === 'who' || step === 'driver' || step === 'how' || step === 'start') return true
  if (step === 'goal') return ctx.hasOrigin
  return ctx.hasOrigin && ctx.hasDestination
}

/** True while the next tap on the map is an endpoint of the route. */
export function isPicking(s: WizardState): boolean {
  return s.active && !s.journey && (s.step === 'start' || s.step === 'goal')
}

/** What follows the goal: options for the astronaut, otherwise the review. */
const afterGoal = (ctx: WizardCtx): WizardStep => (ctx.profile === 'astronaut' ? 'options' : 'review')

export function reduce(s: WizardState, e: WizardEvent, ctx: WizardCtx): WizardState {
  if (e.type === 'begin') return { active: true, step: 'who', journey: false }
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
      return s.step === 'goal' ? { ...s, step: afterGoal(ctx) } : s
    case 'endpointsSet':
      return s.step === 'start' || s.step === 'goal' ? { ...s, step: afterGoal(ctx) } : s
    case 'next':
      if (s.step === 'who') return { ...s, step: 'driver' }
      if (s.step === 'driver') return { ...s, step: ctx.ai ? 'how' : 'start' }
      if (s.step === 'how') return { ...s, step: 'start' }
      if (s.step === 'options') return { ...s, step: 'review' }
      return s
    case 'skip':
      return s.step === 'options' ? { ...s, step: 'review' } : s
    case 'back':
      switch (s.step) {
        case 'who':
          return INITIAL
        case 'driver':
          return { ...s, step: 'who' }
        case 'how':
          return { ...s, step: 'driver' }
        case 'start':
          return { ...s, step: ctx.ai ? 'how' : 'driver' }
        case 'goal':
          return { ...s, step: 'start' }
        case 'options':
          return { ...s, step: 'goal' }
        case 'review':
          return { ...s, step: ctx.profile === 'astronaut' ? 'options' : 'goal' }
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

/** One line for Review: "Reference AI · Guided · Rover RTG" (A* plan has no mode). */
export function driverSummary(kind: string, mode: 'guided' | 'free', profileLabel: string, catalog: readonly { id: string; kind: string; name: string }[] = []): string {
  let who = 'A* plan'
  if (kind === 'user') who = 'Your model'
  else if (kind === 'reference') who = 'Reference AI'
  else if (kind.startsWith('catalog:')) {
    const e = catalog.find((m) => m.id === kind.slice(8))
    who = e ? (e.kind === 'reference' ? 'Reference AI' : 'Example model') : 'AI model'
  }
  return [who, ...(kind === 'astar' ? [] : [mode === 'guided' ? 'Guided' : 'Free']), profileLabel].join(' · ')
}
