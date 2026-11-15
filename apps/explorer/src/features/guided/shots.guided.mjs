/**
 * Screenshots of every step of the guided mission (system Chrome, SwiftShader WebGL).
 * Usage: node src/features/guided/shots.guided.mjs [--url http://localhost:5186] [--theme dark,light] [--vp desktop,mobile] [--data jezero-v1]
 * Output: apps/explorer/.shots/guided/step<N>__<desktop|mobile>__<dark|light>.png and report.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../../../.shots/guided')
fs.mkdirSync(out, { recursive: true })
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const URL_BASE = arg('url', 'http://localhost:5186')
const THEMES = arg('theme', 'dark,light').split(',')
const VPS = arg('vp', 'desktop,mobile').split(',')
const DATA = arg('data', '')
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const report = []
for (const vpName of VPS) {
  const vp = VIEWPORTS[vpName]
  for (const theme of THEMES) {
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
    await page.goto(`${URL_BASE}/?tour=1${DATA ? `&data=${DATA}` : ''}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 120000 })
    const shot = async (name) => {
      await page.waitForTimeout(2500)
      await page.screenshot({ path: path.join(out, `${name}__${vpName}__${theme}.png`) })
    }
    await page.getByRole('region', { name: 'Guided mission' }).waitFor({ timeout: 20000 })
    for (let i = 1; i <= 6; i++) {
      if (i === 5) {
        await page.getByRole('button', { name: 'Open scorecard' }).first().waitFor({ timeout: 180000 }).catch(() => errors.push('[harness] scorecard button never enabled'))
      }
      await shot(`step${i}`)
      if (i === 5) {
        await page.getByText('Re-simulating the episodes').first().waitFor({ state: 'detached', timeout: 180000 }).catch(() => {})
        await page.getByRole('button', { name: 'Open scorecard' }).first().click().catch(() => {})
        await page.getByRole('dialog').waitFor({ timeout: 10000 }).catch(() => errors.push('[harness] dialog did not open'))
        await shot('step5b-scorecard')
        await page.keyboard.press('Escape') // closes the dialog only; the tour stays
        await page.waitForTimeout(2500)
      }
      if (i < 6) await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(600)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    report.push({ vp: vpName, theme, horizontalOverflow: overflow, errors })
    console.log(vpName, theme, overflow ? 'OVERFLOW' : 'no overflow', errors.length ? `${errors.length} console issues` : 'clean')
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
for (const r of report.filter((x) => x.errors.length)) console.log(`${r.vp}/${r.theme}:\n  ${r.errors.slice(0, 6).join('\n  ')}`)
