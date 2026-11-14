/**
 * Screenshot + console harness (Playwright, Chromium with SwiftShader so WebGL works headless).
 * Usage: node scripts/screenshots.mjs [--url http://localhost:5173] [--data synthetic] [--only explore,layers]
 * Output: apps/explorer/.shots/<scenario>__<desktop|mobile>__<dark|light>.png and report.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../.shots')
fs.mkdirSync(out, { recursive: true })
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const URL_BASE = arg('url', 'http://localhost:5173')
const DATA = arg('data', 'synthetic')
const ONLY = arg('only', '')?.split(',').filter(Boolean)

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}

/** each scenario: a name and a function that drives the page after it is ready */
const SCENARIOS = {
  loading: null, // handled separately (captured while data is still downloading)
  webgl_error: null, // handled separately (WebGL2 disabled)
  explore: async (page) => {
    await page.getByRole('button', { name: 'Explore' }).first().click().catch(() => {})
  },
  layers_slope: async (page, vp) => {
    await page.locator(vp === 'mobile' ? 'nav >> text=Layers' : 'button[aria-label="Layers"]').first().click()
    await page.getByRole('radio', { name: 'Slope' }).click()
  },
  data: async (page, vp) => {
    await page.locator(vp === 'mobile' ? 'nav >> text=Data' : 'button[aria-label="Data & Sources"]').first().click()
  },
  fpv: async (page, vp) => {
    await page.keyboard.press('Digit2')
    await page.waitForTimeout(1200)
    if (vp === 'desktop') await page.keyboard.press('Escape')
  },
  chase: async (page) => {
    await page.keyboard.press('Digit3')
    await page.waitForTimeout(1500)
  },
  mission_route: async (page, vp) => {
    await page.locator(vp === 'mobile' ? 'nav >> text=Mission' : 'button[aria-label="Mission"]').first().click()
    const pts = vp === 'mobile' ? [[110, 440], [290, 340]] : [[420, 640], [840, 470]]
    for (const [x, y] of pts) {
      await page.mouse.click(x, y)
      await page.waitForTimeout(500)
    }
    await page.getByText(/Nodes expanded|No route for this profile|Planner error/).first().waitFor({ timeout: 40000 }).catch(() => console.log('  (route result did not appear in 40 s)'))
    await page.waitForTimeout(1500)
  },
  mission: async (page, vp) => {
    await page.locator(vp === 'mobile' ? 'nav >> text=Mission' : 'button[aria-label="Mission"]').first().click()
  },
}

// Use an already-installed Chromium if the revision Playwright expects is not downloaded (set CHROME_PATH to override).
const exe = process.env.CHROME_PATH || findChromium()
function findChromium() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright')
  if (!fs.existsSync(root)) return undefined
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
  for (const d of dirs) {
    const p = path.join(root, d, 'chrome-win64', 'chrome.exe')
    if (fs.existsSync(p)) return p
  }
}
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const report = []
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  for (const theme of ['dark', 'light']) {
    for (const [name, drive] of Object.entries(SCENARIOS)) {
      if (ONLY.length && !ONLY.includes(name)) continue
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
      await ctx.addInitScript((t) => localStorage.setItem('marsx.theme', t), theme)
      const page = await ctx.newPage()
      const errors = []
      page.on('console', (m) => {
        if (['error', 'warning'].includes(m.type())) errors.push(`[${m.type()}] ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`)
      })
      if (name !== 'webgl_error') await page.goto(`${URL_BASE}/?data=${DATA}`, { waitUntil: 'domcontentloaded' })
      const file = path.join(out, `${name}__${vpName}__${theme}.png`)
      if (name === 'webgl_error') {
        await page.addInitScript(() => {
          const orig = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (type, ...a) {
            return type === 'webgl2' || type === 'webgl' ? null : orig.call(this, type, ...a)
          }
        })
        await page.goto(`${URL_BASE}/?data=${DATA}`, { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(800)
        await page.screenshot({ path: file })
        report.push({ name, vp: vpName, theme, errors: errors.filter((e) => !e.includes('webgl')) })
      } else if (name === 'loading') {
        await page.waitForTimeout(250)
        await page.screenshot({ path: file })
      } else {
        const t0 = Date.now()
        await page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 90000 }).catch(() => errors.push('[harness] scene did not become ready in 90 s'))
        const readyMs = Date.now() - t0
        await page.waitForTimeout(1500)
        if (drive) await drive(page, vpName)
        await page.waitForTimeout(1200)
        await page.screenshot({ path: file })
        const m = await page.evaluate(() => ({ ...window.__marsx }))
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
        report.push({ name, vp: vpName, theme, readyMs, marsx: m, horizontalOverflow: overflow, errors })
        console.log(name, vpName, theme, `ready ${readyMs} ms`, JSON.stringify(m), overflow ? 'OVERFLOW' : '', errors.length ? `${errors.length} console issues` : 'clean')
      }
      await ctx.close()
    }
  }
}
await browser.close()
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
const bad = report.filter((r) => r.errors.length)
if (bad.length) {
  console.log('\nCONSOLE ISSUES:')
  for (const r of bad) console.log(`- ${r.name}/${r.vp}/${r.theme}:\n    ${r.errors.slice(0, 5).join('\n    ')}`)
}
