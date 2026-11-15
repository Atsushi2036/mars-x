import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * WCAG 2.2 AA contrast of the design tokens, both themes, read from src/index.css (not retyped here).
 * Text pairs need 4.5:1; UI component edges (input border) need 3:1.
 */
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')

function block(selector: RegExp): Record<string, string> {
  const m = selector.exec(css)
  if (!m) throw new Error(`block ${selector} not found`)
  const out: Record<string, string> = {}
  let depth = 1
  let i = m.index + m[0].length
  const start = i
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++
    if (css[i] === '}') depth--
    i++
  }
  for (const d of css.slice(start, i - 1).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim()
  return out
}

const light = block(/(^|\n):root\s*\{/)
const dark = { ...light, ...block(/\n\.dark\s*\{/) }

type RGB = [number, number, number]
function resolveToken(theme: Record<string, string>, name: string): RGB {
  let v = theme[name]
  for (let n = 0; n < 5 && v && v.startsWith('var('); n++) v = theme[v.slice(6, -1)]
  const m = /^#([0-9a-f]{6})$/i.exec(v ?? '')
  if (!m) throw new Error(`token --${name} is not a plain hex colour: ${v}`)
  const h = m[1]!
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const lin = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}
const blend = (fg: RGB, bg: RGB, a: number): RGB => [0, 1, 2].map((i) => Math.round(fg[i]! * a + bg[i]! * (1 - a))) as RGB

// [foreground token, background token, alpha of the foreground tint over `over` when the background is a tinted chip]
const TEXT: Array<[string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['brand-foreground', 'brand'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'surface'],
  ['muted-foreground', 'muted'],
  ['primary', 'card'],
  ['primary', 'surface'],
  ['destructive', 'card'],
  ['success', 'card'],
  ['warning', 'card'],
  ['sidebar-foreground', 'sidebar'],
  ['rail-foreground', 'rail'],
  ['rail-foreground', 'rail-accent'],
]
// chips render foreground text on a 10 % tint of their tone over the card (Chip, ProvenanceChip); muted text for the assumption chip
const CHIPS = ['primary', 'success', 'warning', 'destructive', 'chart-1', 'chart-3', 'chart-4']

for (const [name, theme] of [
  ['light', light],
  ['dark', dark],
] as const) {
  describe(`contrast AA, ${name} theme`, () => {
    it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
      expect(ratio(resolveToken(theme, fg), resolveToken(theme, bg))).toBeGreaterThanOrEqual(4.5)
    })
    it.each(CHIPS)('foreground text on a 10%% %s tint is at least 4.5:1', (t) => {
      const card = resolveToken(theme, 'card')
      expect(ratio(resolveToken(theme, 'foreground'), blend(resolveToken(theme, t), card, 0.1))).toBeGreaterThanOrEqual(4.5)
    })
    it('input border is at least 3:1 against the card (WCAG 1.4.11)', () => {
      expect(ratio(resolveToken(theme, 'input'), resolveToken(theme, 'card'))).toBeGreaterThanOrEqual(3)
    })
  })
}
