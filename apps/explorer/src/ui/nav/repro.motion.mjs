/**
 * Motion quality of the route Watch, measured per rendered frame on the real GPU.
 * node src/ui/nav/repro.motion.mjs [--profile rover-rtg|astronaut] [--vp desktop|mobile] [--seq]
 * Reports: frames sampled, share of frames where the pose changed, worst heading change per frame, worst deviation from the planned cells,
 * observed on-screen speed. With --seq writes 8 Follow captures 250 ms apart to .shots/redesign/B/motion/.
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
const vpName = arg('vp', 'desktop')
const profile = arg('profile', 'rover-rtg')
const out = path.resolve(here, '../../../.shots/redesign/B/motion')
fs.mkdirSync(out, { recursive: true })
const vp = vpName === 'mobile' ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
await ctx.addInitScript(() => (localStorage.setItem('marsx.theme', 'dark'), localStorage.setItem('marsx.onboarded', '1')))
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
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.agent, null, { timeout: 180000 })
const ok = await page.evaluate(async (prof) => {
  const m = window.__marsx.mission
  m.setMissionProfile(prof)
  await m.setMissionEndpoints({ x: -60, z: 50 }, { x: 70, z: -40 })
  for (let k = 0; k < 240; k++) { if (m.state().outcomes[prof]?.status === 'ok') return true; await new Promise((r) => setTimeout(r, 250)) }
  return false
}, profile)
check('route planned', ok)
await page.waitForTimeout(800)
await page.evaluate(() => window.__marsx.nav?.playback)
// start the Watch through the real button
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /^Watch route/ }).click({ timeout: 15000 })
await page.waitForTimeout(1200)
// sample on every animation frame for 4 s
const stats = await page.evaluate(
  () =>
    new Promise((res) => {
      const a = window.__marsx.agent
      const m = window.__marsx.mission.state()
      const o = m.outcomes[m.profile]
      const ref = o.path
      const rows = []
      const t0 = performance.now()
      const tick = (t) => {
        rows.push({ t, x: a.roverLive.x, z: a.roverLive.z, yaw: a.roverLive.yaw })
        if (t - t0 < 4000) requestAnimationFrame(tick)
        else {
          let changed = 0, worstYaw = 0, worstStep = 0, worstDev = 0, dist = 0
          const wrap = (d) => { d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return d }
          for (let i = 1; i < rows.length; i++) {
            const d = Math.hypot(rows[i].x - rows[i - 1].x, rows[i].z - rows[i - 1].z)
            if (d > 1e-4) changed++
            dist += d
            worstStep = Math.max(worstStep, d / ((rows[i].t - rows[i - 1].t) / 1000))
            worstYaw = Math.max(worstYaw, Math.abs(wrap(rows[i].yaw - rows[i - 1].yaw)))
          }
          for (const r of rows) {
            let best = Infinity
            for (let i = 1; i < ref.length; i++) {
              const p = ref[i - 1], q = ref[i], dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1
              const u = Math.max(0, Math.min(1, ((r.x - p.x) * dx + (r.z - p.z) * dz) / l2))
              best = Math.min(best, Math.hypot(r.x - (p.x + dx * u), r.z - (p.z + dz * u)))
            }
            worstDev = Math.max(worstDev, best)
          }
          res({ frames: rows.length, changed, worstYawDeg: (worstYaw * 180) / Math.PI, avgSpeed: dist / ((rows.at(-1).t - rows[0].t) / 1000), worstSpeed: worstStep, worstDev })
        }
      }
      requestAnimationFrame(tick)
    }),
)
console.log(JSON.stringify(stats))
check('pose changes on (nearly) every frame', stats.changed / (stats.frames - 1) > 0.97, `${stats.changed}/${stats.frames - 1}`)
check('heading never jumps (< 3 deg per frame)', stats.worstYawDeg < 3, `${stats.worstYawDeg.toFixed(2)} deg`)
check('stays within 1 m of the planned cells', stats.worstDev <= 1.05, `${stats.worstDev.toFixed(2)} m`)
const want = profile === 'astronaut' ? 2 : 3
check(`on-screen speed about ${want} m/s at 1x`, stats.avgSpeed > want * 0.75 && stats.avgSpeed < want * 1.25, `${stats.avgSpeed.toFixed(2)} m/s`)
if (process.argv.includes('--seq')) {
  for (let i = 0; i < 8; i++) {
    await page.screenshot({ path: path.join(out, `seq-${profile}-${vpName}-${i}.png`) })
    await page.waitForTimeout(250)
  }
}
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
process.exit(fails ? 1 : 0)
