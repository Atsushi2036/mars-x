import { expect, type Page, type TestInfo } from '@playwright/test'

export const QUERY = process.env.E2E_QUERY ?? ''
export type Theme = 'dark' | 'light'

export interface Issues {
  console: string[]
  page: string[]
  http: string[]
  failed: string[]
  external: string[]
}

/** Collects console errors, uncaught exceptions, HTTP >= 400, failed requests and any cross-origin request. */
export function watch(page: Page, baseURL: string): Issues {
  const issues: Issues = { console: [], page: [], http: [], failed: [], external: [] }
  const origin = new URL(baseURL).origin
  page.on('console', (m) => {
    if (m.type() === 'error') issues.console.push(m.text())
  })
  page.on('pageerror', (e) => issues.page.push(e.message))
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const w = window as unknown as { __csp?: string[] }
      ;(w.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI)
    })
  })
  page.on('response', (r) => {
    if (r.status() >= 400) issues.http.push(`${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => issues.failed.push(`${r.failure()?.errorText} ${r.url()}`))
  page.on('request', (r) => {
    const u = r.url()
    if (/^(data|blob|about):/.test(u)) return
    if (new URL(u).origin !== origin) issues.external.push(u)
  })
  return issues
}

export async function open(page: Page, theme: Theme = 'dark', extraQuery = '') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('marsx.theme', t)
    } catch {
      /* storage unavailable */
    }
  }, theme)
  await page.goto(`/${extraQuery ? (QUERY ? QUERY + '&' : '?') + extraQuery : QUERY}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 300_000 })
  // the loading screen zooms out for about a second after ready: wait for it to leave so it never sits over what a test looks at
  await page.locator('[data-progress]').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {})
}

/** The onboarding card sits over the canvas; dismiss it for tests that click the terrain. */
export async function dismissTips(page: Page) {
  const b = page.getByRole('button', { name: 'Dismiss tips' })
  if (await b.isVisible().catch(() => false)) await b.click()
}

export const isMobile = (info: TestInfo) => info.project.name === 'mobile'

/** Stable mode ids (rail buttons carry `data-mode`); legacy visible names map onto them. */
const MODE_IDS: Record<string, string> = {
  Explore: 'explore',
  Layers: 'layers',
  Mission: 'mission',
  'Plan a route': 'mission',
  'AI Lab': 'lab',
  'Test your AI': 'lab',
  'Data & Sources': 'data',
  Data: 'data',
}

/** Rail button (desktop) or bottom-nav item (mobile) of a mode, found by `data-mode`, not by visible text. Layers is not on the rail: use openMode. */
export function modeButton(page: Page, _info: TestInfo, label: string) {
  const id = MODE_IDS[label] ?? label
  return page.locator(`nav[aria-label="Modes"] button[data-mode="${id}"]`).locator('visible=true').first()
}

/** Opens any mode panel, including Layers (reached from the map, not the rail), through the UI test hook. */
export async function openMode(page: Page, info: TestInfo, label: string) {
  const id = MODE_IDS[label] ?? label
  if (id === 'layers') await page.evaluate(() => window.__marsxUi?.setMode('layers'))
  else await modeButton(page, info, label).click()
}

/** Fraction of canvas pixels that are not near-black, and the luma spread (a flat fill has none). */
export async function canvasStats(page: Page) {
  const png = await page.locator('canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let lit = 0
    let sum = 0
    let sum2 = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!
      if (y > 12) lit++
      sum += y
      sum2 += y * y
    }
    const mean = sum / n
    return { litFraction: lit / n, mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), w: img.width, h: img.height }
  }, png.toString('base64'))
}

export async function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
}

export function expectClean(issues: Issues) {
  expect.soft(issues.page, 'uncaught exceptions').toEqual([])
  expect.soft(issues.console, 'console errors').toEqual([])
  expect.soft(issues.http, 'HTTP >= 400').toEqual([])
  expect.soft(issues.failed, 'failed requests').toEqual([])
  expect.soft(issues.external, 'cross-origin requests (CSP/privacy: everything must be same-origin)').toEqual([])
}

declare global {
  interface Window {
    __marsx?: { ready: boolean; frameCount: number; fps: number; mode: string }
  }
}
