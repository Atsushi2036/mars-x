/**
 * Screenshot + console harness for the feature panels (system Chrome via Playwright, SwiftShader WebGL).
 * Usage: node src/features/shots.mjs [--url http://localhost:5183] [--only scenario,lab] [--theme dark,light] [--vp desktop,mobile]
 * Output: apps/explorer/.shots/features/<name>__<desktop|mobile>__<dark|light>.png and report.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../../.shots/features')
fs.mkdirSync(out, { recursive: true })
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const URL_BASE = arg('url', 'http://localhost:5183')
const ONLY = arg('only', '').split(',').filter(Boolean)
const THEMES = arg('theme', 'dark,light').split(',')
const VPS = arg('vp', 'desktop,mobile').split(',')

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}

async function openMode(page, vp, desktopLabel, mobileText) {
  await page.locator(vp === 'mobile' ? `nav >> text=${mobileText}` : `button[aria-label="${desktopLabel}"]`).first().click()
  await page.waitForTimeout(400)
  if (vp === 'mobile') {
    const h = page.getByRole('button', { name: 'Expand panel' })
    if (await h.count()) await h.first().click({ force: true }).catch((e) => console.log('expand failed', String(e).slice(0, 80)))
    await page.waitForTimeout(300)
  }
}

/** scroll the inspector so that the first element matching `text` is at the top */
async function scrollInspector(page, vp, text) {
  await page.evaluate(
    ({ text }) => {
      const el = [...document.querySelectorAll('aside[aria-label="Inspector"] *')].find((e) => e.children.length === 0 && e.textContent?.trim() === text && e.getClientRects().length > 0)
      el?.scrollIntoView({ block: 'start' })
    },
    { text },
  )
  await page.waitForTimeout(250)
}

export const SCENARIOS = {
  scenario: async (page, vp) => {
    await openMode(page, vp, 'Explore', 'Explore')
    await scrollInspector(page, vp, 'Scenario')
  },
  conditions: async (page, vp) => {
    await openMode(page, vp, 'Explore', 'Explore')
    await scrollInspector(page, vp, 'Current conditions')
  },
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const report = []
// every sibling file shots.<area>.mjs may export SCENARIOS (name -> async (page, vp, theme, helpers))
const ALL = { ...SCENARIOS }
for (const f of fs.readdirSync(here).filter((n) => /^shots\..+\.mjs$/.test(n))) {
  Object.assign(ALL, (await import(pathToFileURL(path.join(here, f)).href)).SCENARIOS ?? {})
}
for (const [name, drive] of Object.entries(ALL)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  for (const vpName of VPS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[vpName].width, height: VIEWPORTS[vpName].height }, isMobile: VIEWPORTS[vpName].isMobile, hasTouch: VIEWPORTS[vpName].hasTouch, deviceScaleFactor: VIEWPORTS[vpName].deviceScaleFactor })
      await ctx.addInitScript((t) => {
        localStorage.setItem('marsx.theme', t)
        localStorage.setItem('marsx.onboarded', '1')
      }, theme)
      const page = await ctx.newPage()
      const errors = []
      page.on('console', (m) => {
        if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver|swiftshader|Clock|WebGL/i.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
      page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()}`))
      try {
        await page.goto(URL_BASE, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 90000 }).catch(() => errors.push('[harness] scene not ready in 90 s'))
        await page.waitForTimeout(500)
        // dismiss onboarding if it is open
        await page.getByRole('button', { name: /skip|got it|close/i }).first().click({ timeout: 1000 }).catch(() => {})
        await drive(page, vpName, theme, { openMode, scrollInspector, errors, out })
        await page.waitForTimeout(700)
        const file = path.join(out, `${name}__${vpName}__${theme}.png`)
        await page.screenshot({ path: file })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
        report.push({ name, vp: vpName, theme, overflow, errors })
        console.log(name, vpName, theme, overflow ? 'OVERFLOW' : '', errors.length ? `${errors.length} console issues` : 'clean')
      } catch (e) {
        report.push({ name, vp: vpName, theme, fatal: String(e), errors })
        console.log(name, vpName, theme, 'FAILED', String(e).slice(0, 200))
      }
      await ctx.close()
    }
  }
}
await browser.close()
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
const bad = report.filter((r) => r.errors?.length || r.fatal || r.overflow)
if (bad.length) {
  console.log('\nISSUES:')
  for (const r of bad) console.log(`- ${r.name}/${r.vp}/${r.theme}: ${r.fatal ?? ''} ${r.overflow ? 'overflow ' : ''}\n    ${(r.errors ?? []).slice(0, 5).join('\n    ')}`)
}
