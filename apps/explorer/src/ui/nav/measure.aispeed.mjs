/** Visual pace of the AI drive replay and the playback controls, desktop or mobile. node src/ui/nav/measure.aispeed.mjs [--vp mobile] */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const vpName = arg('vp', 'desktop')
const out = path.resolve(here, '../../../.shots/redesign/B/drive')
fs.mkdirSync(out, { recursive: true })
const vp = vpName === 'mobile' ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900 }
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1 })
await ctx.addInitScript(() => (localStorage.setItem('marsx.theme', 'dark'), localStorage.setItem('marsx.onboarded', '1')))
const page = await ctx.newPage()
let fails = 0
const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${x}`) }
await page.goto(`${arg('url', 'http://localhost:5193')}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.agent, null, { timeout: 180000 })
await page.evaluate(async () => {
  const A = window.__marsx.agent, m = window.__marsx.mission
  const cat = (await (await fetch('/data/jezero-v1/models/catalog.json')).json()).models
  A.driver.setState({ catalog: cat })
  m.setMissionProfile('rover-rtg')
  await m.setMissionEndpoints({ x: 65, z: 9 }, { x: 279, z: 221 })
  for (let k = 0; k < 240; k++) { if (m.state().outcomes['rover-rtg']?.status === 'ok') break; await new Promise((r) => setTimeout(r, 250)) }
  A.driver.setState({ kind: 'catalog:ppo-reference', mode: 'guided', notice: null, summary: null, phase: 'idle' })
  const { startJourney } = await import('/src/store/watch.ts')
  startJourney()
})
await page.waitForFunction(() => window.__marsx.agent.playback.getState().ai === true, null, { timeout: 60000 })
await page.waitForTimeout(2500)
const sample = (ms) => page.evaluate((ms) => new Promise((res) => {
  const a = window.__marsx.agent.roverLive
  let d = 0, px = a.x, pz = a.z
  const t0 = performance.now()
  const tick = (t) => { d += Math.hypot(a.x - px, a.z - pz); px = a.x; pz = a.z; if (t - t0 < ms) requestAnimationFrame(tick); else res(d / ((t - t0) / 1000)) }
  requestAnimationFrame(tick)
}), ms)
const v1 = await sample(3000)
check('AI replay at 1x moves at about 3 m/s (rover)', v1 > 2.4 && v1 < 3.6, `${v1.toFixed(2)} m/s`)
await page.screenshot({ path: path.join(out, `aispeed-1x__${vpName}.png`) })
await page.getByRole('radio', { name: '2×' }).click()
const v2 = await sample(2500)
check('2x doubles it', v2 / v1 > 1.7 && v2 / v1 < 2.3, `${v2.toFixed(2)} m/s`)
await page.getByRole('radio', { name: '0.5×' }).click()
const vh = await sample(2500)
check('0.5x halves it', vh / v1 > 0.4 && vh / v1 < 0.6, `${vh.toFixed(2)} m/s`)
await page.getByRole('radio', { name: '1×' }).click()
await page.keyboard.press('Space')
await page.waitForTimeout(300)
const vp0 = await sample(1200)
check('pause holds still', vp0 < 0.05, `${vp0.toFixed(3)} m/s`)
const slider = page.getByRole('slider', { name: 'Playback position' })
await slider.focus()
await page.keyboard.press('Home')
await page.waitForTimeout(400)
check('scrubber seeks to the start', (await page.evaluate(() => window.__marsx.agent.playback.getState().t)) < 1)
await page.screenshot({ path: path.join(out, `aispeed-bar__${vpName}.png`) })
await page.getByRole('button', { name: /Exit Watch/ }).click()
check('Exit leaves the Watch', (await page.evaluate(() => window.__marsx.agent.playback.getState().source)) === null)
await browser.close()
process.exit(fails ? 1 : 0)
