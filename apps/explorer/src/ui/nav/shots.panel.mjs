/** Who drives? section in the right panel (wizard Review): node src/ui/nav/shots.panel.mjs [--vp desktop|mobile] [--url ...] */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const vpName = arg('vp', 'desktop')
const out = path.resolve(here, '../../../.shots/redesign/B/drive')
fs.mkdirSync(out, { recursive: true })
const vp = vpName === 'mobile' ? { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
await ctx.addInitScript(() => (localStorage.setItem('marsx.theme', 'dark'), localStorage.setItem('marsx.onboarded', '1')))
const page = await ctx.newPage()
await page.goto(`${arg('url', 'http://localhost:5193')}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.agent, null, { timeout: 180000 })
await page.evaluate(async () => {
  const m = window.__marsx.mission
  m.setMissionProfile('rover-rtg')
  await m.setMissionEndpoints({ x: 65, z: 9 }, { x: 279, z: 221 })
  for (let k = 0; k < 240; k++) { if (m.state().outcomes['rover-rtg']?.status === 'ok') return; await new Promise((r) => setTimeout(r, 250)) }
})
await page.getByRole('button', { name: vpName === 'desktop' ? /Plan a route/ : /^Plan$/ }).first().click()
await page.waitForTimeout(1500)
for (let k = 0; k < 5; k++) {
  if (await page.getByRole('radiogroup', { name: 'Who drives?' }).isVisible().catch(() => false)) break
  const next = page.getByRole('button', { name: /^Continue$/ })
  if (await next.isVisible().catch(() => false)) await next.click()
  await page.waitForTimeout(600)
}
if (vpName === 'mobile') { const h = page.getByRole('button', { name: /Expand panel/ }); if (await h.count()) { await h.click(); await page.waitForTimeout(700) } }
const s = (n) => page.screenshot({ path: path.join(out, `panel-${n}__${vpName}.png`) })
await s('1-astar')
await page.getByRole('radio', { name: /Reference AI/ }).first().click()
await page.waitForTimeout(500)
await s('2-reference-guided')
await page.getByRole('radio', { name: /Free \(goal only\)/ }).click()
await page.waitForTimeout(400)
await s('3-free')
console.log('radios:', await page.getByRole('radiogroup', { name: 'Who drives?' }).getByRole('radio').count())
await browser.close()
