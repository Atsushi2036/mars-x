/**
 * Captures the Export section in two states: packages published (dev server) and not published (index.json answers 404).
 * Usage: node src/features/export/shots.export.mjs [--url http://localhost:5186] [--out polish/5-export]
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
const URL_BASE = arg('url', 'http://localhost:5186')
const out = path.resolve(here, '../../../.shots', arg('out', 'polish/5-export'))
fs.mkdirSync(out, { recursive: true })
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] })
const problems = []
for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
  for (const theme of ['dark', 'light']) {
    for (const state of ['published', 'unpublished', 'partial']) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
      await ctx.addInitScript((t) => localStorage.setItem('marsx.theme', t), theme)
      const page = await ctx.newPage()
      page.on('pageerror', (e) => problems.push(`${vpName}/${theme}/${state}: ${e.message}`))
      if (state === 'unpublished') await page.route('**/export/index.json', (r) => r.fulfill({ status: 404, body: 'not found' }))
      // partial: the index lists the ZIPs but the first one is gone (the host answers its SPA page)
      if (state === 'partial') {
        let first = true
        await page.route('**/export/*.zip', (r) => {
          if (r.request().method() === 'HEAD' && first) {
            first = false
            return r.fulfill({ status: 200, contentType: 'text/html', body: '' })
          }
          return r.continue()
        })
      }
      await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 120000 })
      await page.locator('nav button[data-mode="data"]:visible').first().click()
      await page.waitForTimeout(2500)
      await page.evaluate(() => {
        const h = [...document.querySelectorAll('aside[aria-label="Inspector"] h3')].find((e) => e.textContent?.startsWith('Export to Gazebo'))
        const view = document.querySelector('aside[aria-label="Inspector"] [data-radix-scroll-area-viewport], aside[aria-label="Inspector"] .overscroll-contain')
        if (h && view) view.scrollTop += h.getBoundingClientRect().top - view.getBoundingClientRect().top - 4
      })
      if (vpName === 'mobile') await page.getByRole('button', { name: 'Expand panel' }).first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(800)
      const links = await page.evaluate(() => [...document.querySelectorAll('aside a[download]')].map((a) => a.getAttribute('href')))
      for (const l of links) {
        const r = await page.request.head(new URL(l, URL_BASE).href)
        if (!r.ok() || (r.headers()['content-type'] ?? '').includes('html')) problems.push(`${vpName}/${theme}/${state}: broken link ${l}`)
      }
      await page.screenshot({ path: path.join(out, `export_${state}__${vpName}__${theme}.png`) })
      console.log(vpName, theme, state, `${links.length} download links`)
      await ctx.close()
    }
  }
}
await browser.close()
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no broken links, no page errors')
