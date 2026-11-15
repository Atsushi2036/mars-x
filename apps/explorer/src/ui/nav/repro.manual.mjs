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

// manual flow: Plan a route -> tap the start -> tap the goal -> Watch (real taps on the terrain)
await page.getByRole('button', { name: vpName === 'desktop' ? /Plan a route/ : /^Plan$/ }).first().click()
await page.waitForTimeout(1500)
const tap = async (x, y) => { if (vpName === 'desktop') await page.mouse.click(x, y); else await page.touchscreen.tap(x, y) }
const W = vp.width, H = vp.height
await page.screenshot({ path: path.join(out, 'm0-plan-open__' + profile + '__' + vpName + '.png') })
await tap(W * 0.32, H * 0.55)
await page.waitForTimeout(700)
await tap(W * 0.45, H * 0.38)
let ok = false
for (let k = 0; k < 80 && !ok; k++) { await page.waitForTimeout(250); ok = await page.evaluate(() => { const m = window.__marsx.mission.state(); return m.outcomes[m.profile]?.status === 'ok' }) }
check('manual plan produced a route', ok, JSON.stringify(await page.evaluate(() => { const m = window.__marsx.mission.state(); return { o: m.origin, d: m.destination, out: Object.fromEntries(Object.entries(m.outcomes).map(([k, v]) => [k, v.status])) } })))
await page.waitForTimeout(1200)
let s = await state()
check('manual: agent on the origin after the plan', s.toOrigin !== null && s.toOrigin < 3, JSON.stringify(s))
await page.screenshot({ path: path.join(out, 'm1-planned__' + profile + '__' + vpName + '.png') })
// the wizard (Plan a route) leads to the journey: Continue ... Start the journey
for (let k = 0; k < 5; k++) {
  const go = page.getByRole('button', { name: /Start the journey/ })
  if (await go.isVisible().catch(() => false)) { await go.click(); break }
  const next = page.getByRole('button', { name: /^Continue$/ })
  if (await next.isVisible().catch(() => false)) await next.click()
  await page.waitForTimeout(600)
}
check('manual: the journey started', await page.evaluate(() => window.__marsx.agent.playback.getState().source === 'route'))
await page.waitForTimeout(1500)
let worst = 0
for (let i = 0; i < 6; i++) { s = await state(); worst = Math.max(worst, s.toPath); await page.waitForTimeout(600) }
check('manual: Watch keeps the agent on the polyline', s.src === 'route' && worst < 2, JSON.stringify(s))
await page.screenshot({ path: path.join(out, 'm2-watching__' + profile + '__' + vpName + '.png') })
check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
process.exit(fails ? 1 : 0)
