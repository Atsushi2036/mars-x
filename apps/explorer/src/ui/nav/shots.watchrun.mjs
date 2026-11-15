/**
 * Watch run: loads the example run.json in Test your AI, selects an episode, presses "Watch run" and checks the playback bar
 * (events, speed, Space, Exit) on the real GPU. Usage: node src/ui/nav/shots.watchrun.mjs [--url http://localhost:5193] [--vp desktop|mobile]
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
const out = path.resolve(here, '../../../.shots/redesign/B')
fs.mkdirSync(out, { recursive: true })
const vpName = arg('vp', 'desktop')
const vp = vpName === 'mobile' ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
const runFile = path.resolve(here, '../../../../../bench/jezero-v1/baselines/example.run.json')
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
await ctx.addInitScript(() => {
  localStorage.setItem('marsx.theme', 'dark')
  localStorage.setItem('marsx.onboarded', '1')
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(e.message))
let fails = 0
const check = (n, ok, x = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${x}`)
}
await page.goto(`${arg('url', 'http://localhost:5193')}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.nav, null, { timeout: 180000 })
const nav = (fn, a) => page.evaluate(({ f, a }) => new Function('n', 'a', `return (${f})(n, a)`)(window.__marsx.nav, a), { f: fn.toString(), a })
// planning layers are needed to place the trajectory on the terrain
await page.evaluate(async () => {
  await window.__marsx.mission.setMissionEndpoints({ x: -120, z: 90 }, { x: 160, z: -110 })
})
await page.getByRole('button', { name: vpName === 'desktop' ? /Test your AI/ : /^Test AI$/ }).first().click()
await page.waitForTimeout(800)
await page.getByRole('radio', { name: /Bring your model/ }).or(page.getByRole('button', { name: /Bring your model/ })).first().click()
await page.waitForTimeout(500)
await page.locator('input[type=file][accept*=json]').first().setInputFiles(runFile)
const ep = page.getByRole('list', { name: 'Episodes' }).getByRole('button').first()
await ep.waitFor({ timeout: 60000 })
await ep.click()
const watch = page.getByRole('button', { name: /^Watch run/ })
await watch.waitFor({ timeout: 30000 })
check('Watch run appears after selecting an episode', await watch.isVisible())
await page.screenshot({ path: path.join(out, `14-watch-run-button__${vpName}__dark.png`) })
const meas = () => page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (performance.now() - t0 < 3000 ? (n++, requestAnimationFrame(f)) : res(n / 3)); requestAnimationFrame(f) }))
const fpsIdle = await meas()
console.log('reference fps (orbit, before Watch):', fpsIdle.toFixed(1))
await watch.click()
await page.waitForTimeout(1200)
check('enters Follow', (await nav((n) => n.camera.getState().mode)) === 'chase')
const info = await nav((n) => ({ src: n.playback.getState().source, dur: n.playback.getState().duration, ev: n.playback.getState().events.length }))
check('run source with events', info.src === 'run' && info.dur > 10 && info.ev >= 1, JSON.stringify(info))
const t1 = await nav((n) => n.playback.getState().t)
await page.getByRole('radio', { name: '1×' }).click()
const fps = await meas()
check('fps while watching a run at 1x', fps > fpsIdle * 0.8, fps.toFixed(1) + ' fps')
await page.getByRole('radio', { name: '4×' }).click()
await page.waitForTimeout(1500)
const t2 = await nav((n) => n.playback.getState().t)
check('4x advances about 4 x 24 steps per second', t2 - t1 > 100, `dt ${(t2 - t1).toFixed(0)} steps`)
await page.screenshot({ path: path.join(out, `15-watch-run__${vpName}__dark.png`) })
await page.keyboard.press('Space')
await page.waitForTimeout(300)
const p1 = await nav((n) => n.playback.getState().t)
await page.waitForTimeout(600)
check('Space pauses the run', Math.abs((await nav((n) => n.playback.getState().t)) - p1) < 1)
await page.getByRole('button', { name: /Exit Watch/ }).click()
check('Exit leaves Watch', (await nav((n) => n.playback.getState().source)) === null)
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
process.exit(fails ? 1 : 0)
