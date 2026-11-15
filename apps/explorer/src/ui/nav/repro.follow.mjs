/** Follow fix harness: the agent sits at the origin after a plan, Watch walks the polyline exactly. node src/ui/nav/repro.follow.mjs [--vp desktop|mobile] [--profile rover-rtg|astronaut] [--shots] */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const vpName = arg('vp', 'desktop')
const profile = arg('profile', 'rover-rtg')
const out = path.resolve(here, '../../../.shots/redesign/B/follow-fix')
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
const check = (n, ok, x = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n} ${x}`) }
await page.goto(`${arg('url', 'http://localhost:5193')}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.nav, null, { timeout: 180000 })
const plan = (prof, a, b) => page.evaluate(async ([prof, a, b]) => {
  const m = window.__marsx.mission
  m.setMissionProfile(prof)
  await m.setMissionEndpoints(a, b)
  for (let k = 0; k < 200; k++) { if (m.state().outcomes[prof]?.status === 'ok') return true; await new Promise((r) => setTimeout(r, 250)) }
  return false
}, [prof, a, b])
const state = () => page.evaluate(() => {
  const n = { ...window.__marsx.agent, rover: window.__marsx.agent.rover }, m = window.__marsx.mission.state()
  const o = m.outcomes[m.profile]
  const p = o?.status === 'ok' ? o.path : []
  const hyp = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
  // distance from the agent to the polyline (min over segments)
  let dMin = Infinity
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((n.roverLive.x - a.x) * dx + (n.roverLive.z - a.z) * dz) / l2))
    dMin = Math.min(dMin, hyp(n.roverLive, { x: a.x + dx * t, z: a.z + dz * t }))
  }
  return { toOrigin: p[0] ? hyp(n.roverLive, p[0]) : null, toPath: dMin, toEnd: p.length ? hyp(n.roverLive, p[p.length - 1]) : null, t: n.playback.getState().t, src: n.playback.getState().source, status: n.rover.getState().status, kind: n.agentLive.kind, profile: m.profile }
})
const A = { x: -60, z: 50 }, B = { x: 70, z: -40 }
// demo loop first, as a user could have pressed it
await page.evaluate(() => { const n = window.__marsx.agent; n.rover.getState().followPath([{ x: n.roverLive.x + 40, z: n.roverLive.z }, { x: n.roverLive.x, z: n.roverLive.z + 40 }], 2, true) })
await page.waitForTimeout(500)
check('plan ok', await plan(profile, A, B))
await page.waitForTimeout(1200)
let s = await state()
check('agent sits at the origin after the plan (no Watch)', s.toOrigin !== null && s.toOrigin < 3, JSON.stringify(s))
check('demo loop stopped by the plan', s.status !== 'driving', s.status)
if (process.argv.includes('--shots')) { await page.getByRole('button', { name: /Follow camera/ }).click(); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(out, `a-at-origin__${profile}__${vpName}.png`) }); await page.keyboard.press('Digit1') }
const watch = page.getByRole('button', { name: /^Watch route/ })
await watch.waitFor({ timeout: 10000 })
await watch.click()
await page.waitForTimeout(800)
let worst = 0
for (let i = 0; i < 10; i++) { s = await state(); worst = Math.max(worst, s.toPath); await page.waitForTimeout(500) }
check('Watch: agent stays on the polyline', worst < 2, `worst ${worst.toFixed(2)} m`)
s = await state()
check('Watch advanced from the origin', s.t > 0.2 && s.toOrigin > 1, JSON.stringify(s))
if (process.argv.includes('--shots')) await page.screenshot({ path: path.join(out, `b-watching__${profile}__${vpName}.png`) })
await page.getByRole('button', { name: /Exit Watch/ }).click()
await page.waitForTimeout(600)
const afterExit = await state()
await page.waitForTimeout(800)
const later = await state()
check('Exit leaves the agent where it was', Math.abs(afterExit.toOrigin - later.toOrigin) < 0.5, `${afterExit.toOrigin?.toFixed(1)} -> ${later.toOrigin?.toFixed(1)}`)
// replan with the other profile / new endpoints: agent repositions to the new origin
const other = profile === 'astronaut' ? 'rover-rtg' : 'astronaut'
check('replan other profile', await plan(other, { x: -100, z: 20 }, { x: 40, z: 90 }))
await page.waitForTimeout(1200)
s = await state()
check('profile change moves the agent to the new origin', s.toOrigin !== null && s.toOrigin < 3 && s.profile === other, JSON.stringify(s))
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
process.exit(fails ? 1 : 0)
