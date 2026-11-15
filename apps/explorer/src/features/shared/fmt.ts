/** Number formatting shared by the feature panels. Missing values are always "No data", never a placeholder number. */
export const NO_DATA = 'No data'

const nf = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const f0 = nf(0)
const f1 = nf(1)
const f2 = nf(2)
const f3 = nf(3)

const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const minus = (s: string) => s.replace('-', '−')

export function fmtNum(v: number | null | undefined, digits = 1, unit = ''): string {
  if (!ok(v)) return NO_DATA
  const f = digits === 0 ? f0 : digits === 1 ? f1 : digits === 2 ? f2 : f3
  return minus(f.format(v)) + (unit ? ` ${unit}` : '')
}

export const kelvinToC = (k: number) => k - 273.15

/** "-83 to -9 °C" from kelvin extremes. */
export function fmtTempRange(minK: number | null | undefined, maxK: number | null | undefined): string {
  if (!ok(minK) || !ok(maxK)) return NO_DATA
  return `${minus(f0.format(kelvinToC(minK)))} to ${minus(f0.format(kelvinToC(maxK)))} °C`
}

export function fmtPressureRange(minPa: number | null | undefined, maxPa: number | null | undefined): string {
  if (!ok(minPa) || !ok(maxPa)) return NO_DATA
  return `${f0.format(minPa)} to ${f0.format(maxPa)} Pa`
}

/** Hours of a sol (0..24.66) as HH:MM. */
export function fmtClock(hours: number): string {
  if (!ok(hours)) return NO_DATA
  const total = Math.round(hours * 60)
  const h = Math.floor(total / 60)
  const m = total - h * 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** One-way light time in seconds as "12.4 min". */
export function fmtOwlt(seconds: number | null | undefined): string {
  if (!ok(seconds)) return NO_DATA
  return `${f1.format(seconds / 60)} min`
}

export function fmtHoursUntil(hours: number | null | undefined): string {
  if (!ok(hours)) return NO_DATA
  if (hours < 1) return `${f0.format(hours * 60)} min`
  return `${f1.format(hours)} h`
}

/**
 * A fraction (0..1) as a percent number, honest at the ends: anything below 1 never reads "100" and anything above 0
 * never reads "0" because of rounding (99.75 % with one decimal is "99.8", 99.96 % is "99.9").
 */
export function pctNumber(v: number, digits = 1): string {
  const p = v * 100
  const s = p.toFixed(digits)
  const step = 10 ** -digits
  if (v < 1 && Number(s) >= 100) return (100 - step).toFixed(digits)
  if (v > 0 && Number(s) <= 0) return step.toFixed(digits)
  return s
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (!ok(v)) return NO_DATA
  return `${pctNumber(v, digits)}%`
}

/** "84.0% (81.0 to 87.0)" */
export function fmtCi(p: number | null | undefined, ci: readonly [number, number] | null | undefined): string {
  if (!ok(p) || !ci || !ok(ci[0]) || !ok(ci[1])) return NO_DATA
  return `${pctNumber(p)}% (${pctNumber(ci[0])} to ${pctNumber(ci[1])})`
}

export function fmtDeg(v: number | null | undefined, digits = 1): string {
  return ok(v) ? `${minus(nf(digits).format(v))}°` : NO_DATA
}

export function short(hash: string | null | undefined, n = 10): string {
  return hash ? `${hash.slice(0, n)}…` : NO_DATA
}
