/** Pure helpers for the day animation (a sol is 24.65 mean solar hours, the range of the sun tables). */
export const SOL_HOURS = 24.65

/** Real seconds a full sol takes on screen for each speed preset. */
export const DAY_SPEEDS = { slow: 60, normal: 30, fast: 12 } as const
export type DaySpeed = keyof typeof DAY_SPEEDS

/** Advances a local mean solar time (hours) by `dtSeconds` of real time and wraps it into [0, SOL_HOURS). */
export function advanceClock(hours: number, dtSeconds: number, secondsPerSol: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(dtSeconds) || secondsPerSol <= 0) return hours
  const next = hours + (dtSeconds * SOL_HOURS) / secondsPerSol
  return ((next % SOL_HOURS) + SOL_HOURS) % SOL_HOURS
}
