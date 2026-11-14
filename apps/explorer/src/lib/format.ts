const nf = (digits: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const n0 = nf(0)
const n1 = nf(1)

export function fmtLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`
}

export function fmtLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`
}

/** Elevation with a true minus sign (U+2212), metres. */
export function fmtElevation(m: number): string {
  const s = n1.format(Math.abs(m))
  return `${m < 0 ? '−' : ''}${s} m`
}

export function fmtDeg(d: number): string {
  return `${n1.format(d)}°`
}

export function fmtInt(n: number): string {
  return n0.format(n)
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${n1.format(b / 1024)} KB`
  return `${n1.format(b / (1024 * 1024))} MB`
}
