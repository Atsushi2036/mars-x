/**
 * Capture harness for the redesigned panels (system Chrome, SwiftShader WebGL).
 * Usage: node src/ui/panels/shots.mjs [--url http://localhost:5197] [--pkg D] [--only explore,plan] [--theme dark,light] [--vp desktop,mobile]
 * Output: apps/explorer/.shots/redesign/<pkg>/<name>__<desktop|mobile>__<dark|light>.png and report.json (console issues, overflow).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const URL_BASE = arg('url', 'http://localhost:5197')
const PKG = arg('pkg', 'D')
const ONLY = arg('only', '').split(',').filter(Boolean)
const THEMES = arg('theme', 'dark,light').split(',')
const VPS = arg('vp', 'desktop,mobile').split(',')
const out = path.resolve(here, '../../../.shots/redesign', PKG)
fs.mkdirSync(out, { recursive: true })

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}

async function openMode(page, vp, label, mobileLabel) {
  const name = vp === 'mobile' ? mobileLabel : label
  await page.locator('nav button:visible').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first().click()
  await page.waitForTimeout(1100)
  if (vp === 'mobile') {
    const h = page.getByRole('button', { name: 'Expand panel' })
    for (let i = 0; i < 2; i++) if (await h.count()) await h.first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

async function scrollPanel(page, y) {
  await page.evaluate((y) => {
    const a = document.querySelector('aside[aria-label="Inspector"]')
    if (!a) return
    const els = [a, ...a.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY) || e.hasAttribute('data-radix-scroll-area-viewport'))
    els.forEach((e) => (e.scrollTop = y))
  }, y)
  await page.waitForTimeout(250)
}

export const SCENARIOS = {
  explore: async (page, vp) => openMode(page, vp, 'Explore', 'Explore'),
  'explore-2': async (page, vp) => {
    await openMode(page, vp, 'Explore', 'Explore')
    await scrollPanel(page, vp === 'mobile' ? 600 : 520)
  },
  plan: async (page, vp) => openMode(page, vp, 'Plan a route', 'Plan'),
  'plan-result': async (page, vp) => {
    await openMode(page, vp, 'Plan a route', 'Plan')
    await page.getByRole('button', { name: 'Use a sample route' }).click()
    await page.getByText('Distance', { exact: true }).first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(800)
  },
  'plan-astronaut': async (page, vp) => {
    await openMode(page, vp, 'Plan a route', 'Plan')
    await page.getByRole('radio', { name: /Astronaut/ }).click()
    await page.getByRole('button', { name: 'Use a sample route' }).click()
    await page.getByText('Distance', { exact: true }).first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(800)
    await scrollPanel(page, vp === 'mobile' ? 900 : 700)
  },
  lab: async (page, vp) => openMode(page, vp, 'Test your AI', 'Test AI'),
  'lab-trained': async (page, vp) => {
    await openMode(page, vp, 'Test your AI', 'Test AI')
    await page.getByRole('button', { name: 'Train', exact: true }).click()
    await page.waitForTimeout(9000)
    await scrollPanel(page, vp === 'mobile' ? 380 : 330)
  },
  train: async (page, vp, _theme, shot) => {
    await openMode(page, vp, 'Test your AI', 'Test AI')
    const cv = page.locator('canvas[aria-label^="Learning grid"]')
    await cv.scrollIntoViewIfNeeded()
    await shot('0-before')
    await page.getByRole('button', { name: 'Train', exact: true }).click()
    // 1. Fast: agent wandering, floating numbers
    await page.waitForTimeout(3500)
    await cv.scrollIntoViewIfNeeded()
    await shot('1-fast-wandering')
    // 2. Slow: agent half way, then a hazard (bump) and the timeout banner
    await page.getByRole('radio', { name: 'Slow' }).click()
    const seen = new Set()
    for (let i = 0; i < 80 && seen.size < 2; i++) {
      await page.waitForTimeout(250)
      const b = await cv.getAttribute('data-banner')
      if (!seen.has('mid') && i === 6) { seen.add('mid'); await shot('2-slow-mid-episode') }
      if (b && !seen.has(b.split(' ')[0])) { seen.add(b.split(' ')[0]); await shot('3-banner-' + b.split(' ')[0].replace(/[^a-z]/gi, '')) }
    }
    // 3. learn for a while at Turbo, then show what it learned
    await page.getByRole('radio', { name: 'Turbo' }).click()
    await page.waitForTimeout(25000)
    await page.getByRole('radio', { name: 'Value' }).click()
    await page.waitForTimeout(1500)
    await shot('4-value-map')
    await page.getByRole('radio', { name: 'Best moves' }).click()
    await page.waitForTimeout(1500)
    await shot('5-best-moves')
    // 4. Slow again with a trained agent: catch the goal banner
    await page.getByRole('radio', { name: 'Paths' }).click()
    await page.getByRole('radio', { name: 'Slow' }).click()
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(250)
      const b = await cv.getAttribute('data-banner')
      if (b && b.includes('Goal')) { await shot('6-goal-reached'); break }
    }
    await page.waitForTimeout(500)
  },
  'lab-byo': async (page, vp) => {
    await openMode(page, vp, 'Test your AI', 'Test AI')
    await page.getByRole('radio', { name: /Bring your model/ }).click()
    await page.waitForTimeout(600)
    await scrollPanel(page, vp === 'mobile' ? 300 : 280)
  },
  data: async (page, vp) => openMode(page, vp, 'Data', 'Data'),
  'data-2': async (page, vp) => {
    await openMode(page, vp, 'Data', 'Data')
    await scrollPanel(page, 700)
  },
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
})
const report = []
for (const [name, drive] of Object.entries(SCENARIOS)) {
  if (ONLY.length && !ONLY.includes(name)) continue
  for (const vpName of VPS) {
    for (const theme of THEMES) {
      const v = VIEWPORTS[vpName]
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor })
      await ctx.addInitScript((t) => {
        localStorage.setItem('marsx.theme', t)
        localStorage.setItem('marsx.onboarded', '1')
        try { sessionStorage.setItem('marsx.flyin', '1') } catch { /* ignore */ }
      }, theme)
      const page = await ctx.newPage()
      const errors = []
      page.on('console', (m) => {
        if (['error', 'warning'].includes(m.type()) && !/GPU stall|GL Driver|swiftshader|Clock|WebGL/i.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`)
      })
      page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
      try {
        await page.goto(URL_BASE, { waitUntil: 'load' })
        await page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 120000 }).catch(() => errors.push('[harness] scene not ready in 120 s'))
        await page.waitForTimeout(600)
        await page.getByRole('button', { name: /^(skip|got it)$/i }).first().click({ timeout: 800 }).catch(() => {})
        await drive(page, vpName, theme, (n) => { fs.mkdirSync(path.join(out, 'train'), { recursive: true }); return page.screenshot({ path: path.join(out, 'train', n + '__' + vpName + '__' + theme + '.png') }) })
        await page.waitForTimeout(600)
        await page.screenshot({ path: path.join(out, `${name}__${vpName}__${theme}.png`) })
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
