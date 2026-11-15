/**
 * Who drives: the reference AI (PPO 0.2.0) runs live in the browser from the route's start to its goal.
 * node src/ui/nav/shots.drive.mjs [--vp desktop|mobile] [--url http://localhost:5193] [--from -300,200] [--to 100,-150] [--tag reach|fail] [--user]
 * Output: .shots/redesign/B/drive/<tag>-<step>__<vp>.png
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
const tag = arg('tag', 'reach')
const pair = (s) => s.split(',').map(Number)
const [fx, fz] = pair(arg('from', '-300,200'))
const [tx, tz] = pair(arg('to', '100,-150'))
const out = path.resolve(here, '../../../.shots/redesign/B/drive')
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
const shot = (n) => page.screenshot({ path: path.join(out, `${tag}-${n}__${vpName}.png`) })

if (process.argv.includes('--user')) {
  // the user's own model: drop the file in Test your AI exactly like a user would
  await page.getByRole('button', { name: vpName === 'desktop' ? /Test your AI/ : /^Test AI$/ }).first().click()
  await page.waitForTimeout(800)
  await page.getByRole('radio', { name: /Bring your model/ }).or(page.getByRole('button', { name: /Bring your model/ })).first().click()
  await page.waitForTimeout(500)
  await page.locator('input[type=file][accept*=onnx]').first().setInputFiles(path.resolve(here, '../../../../../models/jezero-v1/policy.onnx'))
  await page.waitForTimeout(6000)
}

const ok = await page.evaluate(async ([a, b, prof]) => {
  const m = window.__marsx.mission
  m.setMissionProfile(prof)
  await m.setMissionEndpoints({ x: a[0], z: a[1] }, { x: b[0], z: b[1] })
  for (let k = 0; k < 240; k++) { if (m.state().outcomes[prof]?.status === 'ok') return true; await new Promise((r) => setTimeout(r, 250)) }
  return false
}, [[fx, fz], [tx, tz], arg('profile', 'rover-rtg')])
check('A* route planned', ok)
await page.getByRole('button', { name: vpName === 'desktop' ? /Plan a route/ : /^Plan$/ }).first().click().catch(() => {})
await page.waitForTimeout(1000)
// leave the wizard UI out of the way: use the dock Watch stack
await page.evaluate(() => window.__marsx.agent && 0)
await page.keyboard.press('Escape')
await page.getByRole('button', { name: /^Explore$/ }).first().click().catch(() => {})
await page.waitForTimeout(800)
const picker = page.getByRole('radiogroup', { name: 'Who drives?' })
await picker.waitFor({ timeout: 10000 })
await shot('0-picker')
check('three drivers offered', (await picker.getByRole('radio').count()) === 3)
const userDisabled = await picker.getByRole('radio', { name: /Your model/ }).getAttribute('aria-disabled')
check('Your model state', process.argv.includes('--user') ? userDisabled === 'false' : userDisabled === 'true', `aria-disabled=${userDisabled}`)
await picker.getByRole('radio', { name: process.argv.includes('--user') ? /Your model/ : /Reference AI/ }).click()
await page.waitForTimeout(400)
await shot('1-selected')
await page.getByRole('button', { name: /^Watch route/ }).click()
await page.waitForTimeout(1500)
console.log('errors so far:', errors.slice(0, 4).join(' || ').slice(0, 800))
const t0 = Date.now()
await page.waitForFunction(() => window.__marsx.agent.playback.getState().ai === true, null, { timeout: 60000 }).catch(() => {})
check('AI drive started (no fallback)', await page.evaluate(() => window.__marsx.agent.playback.getState().ai === true), await page.evaluate(() => document.body.innerText.match(/Could not run[^.]*\./)?.[0] ?? ''))
await page.waitForTimeout(2500)
await shot('2-driving')
const mid = await page.evaluate(() => { const p = window.__marsx.agent.playback.getState(); return { t: p.t, dur: p.duration, ev: p.events.length } })
console.log('mid', JSON.stringify(mid))
await page.waitForFunction(() => /Reached the goal|Hit an obstacle|Ran out|Missed|failed/.test(document.body.innerText) || !window.__marsx.agent.playback.getState().ai, null, { timeout: 120000 }).catch(() => {})
await page.waitForTimeout(1500)
const rate = await page.evaluate(() => { const p = window.__marsx.agent.playback.getState(); return { dur: p.duration } })
console.log('steps produced', rate.dur, 'in', ((Date.now() - t0) / 1000).toFixed(1), 's wall incl. loading and playback')
await shot('3-end')
const txt = await page.evaluate(() => document.body.innerText)
console.log('card:', (txt.match(/(Reached the goal|Hit an obstacle|Ran out of [a-z ]+|Missed the shelter window|The model failed)[\s\S]{0,120}/) ?? [''])[0].replace(/\s+/g, ' '))
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
process.exit(fails ? 1 : 0)
