/** Follow camera with the astronaut avatar. Usage: node src/ui/nav/shots.astronaut.mjs [--url http://127.0.0.1:5170] */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const i = process.argv.indexOf('--url')
const base = i > -1 ? process.argv[i + 1] : 'http://127.0.0.1:5170'
const out = path.resolve(here, '../../../.shots/redesign/B')
fs.mkdirSync(out, { recursive: true })
const VPS = { desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
let fails = 0
for (const [name, vp] of Object.entries(VPS)) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
  await ctx.addInitScript(() => (localStorage.setItem('marsx.theme', 'dark'), localStorage.setItem('marsx.onboarded', '1')))
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.nav, null, { timeout: 180000 })
  const ok = await page.evaluate(async () => {
    const m = window.__marsx.mission
    m.setMissionProfile('astronaut')
    await m.setMissionEndpoints({ x: -60, z: 50 }, { x: 70, z: -40 })
    for (let k = 0; k < 120; k++) {
      if (m.state().outcomes.astronaut?.status === 'ok') return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return JSON.stringify(m.state().outcomes.astronaut)
  })
  if (ok !== true) console.log('plan:', ok)
  await page.screenshot({ path: path.join(out, '_dbg.png') })
  await page.getByRole('button', { name: /^Watch route/ }).click({ timeout: 15000 })
  await page.waitForTimeout(2500)
  await page.getByRole('radio', { name: '4×' }).click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(out, `16-follow-astronaut__${name}__dark.png`) })
  if (name === 'desktop') {
    // look back at the astronaut: drag the Follow view half a turn
    await page.mouse.move(700, 300)
    await page.mouse.down()
    await page.mouse.move(1220, 300, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(out, '17-astronaut-front__desktop__dark.png') })
  }
  const kind = await page.evaluate(() => window.__marsx.nav.playback.getState().source)
  if (kind !== 'route') fails++
  console.log(name, 'source', kind, 'errors', errors.length, errors.slice(0, 2).join(' | '))
  await ctx.close()
}
await browser.close()
process.exit(fails ? 1 : 0)
