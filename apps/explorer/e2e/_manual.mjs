import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const U = process.env.E2E_URL ?? 'https://preview.mars-x-7k9.pages.dev'
const OUT = path.resolve('e2e/__shots__/manual')
fs.mkdirSync(OUT, { recursive: true })
const EX = path.resolve('../../bench/jezero-v1/baselines/example.run.json')
const ARGS = ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
const which = process.argv[2] ?? 'all'
const browser = await chromium.launch({ channel: 'chrome', args: ARGS })
const notes = []
const say = (...a) => { console.log(...a); notes.push(a.join(' ')) }

async function ctxPage(vp, extra = {}) {
  const ctx = await browser.newContext({ viewport: vp, ...extra })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('marsx.theme', 'dark') } catch {}
    document.addEventListener('securitypolicyviolation', (e) => ((window.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI + ' @' + e.sourceFile)))
  })
  const page = await ctx.newPage()
  const log = []
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log.push(`[${m.type()}] ${m.text().slice(0, 200)}`))
  page.on('pageerror', (e) => log.push('[pageerror] ' + e.message))
  page.on('response', (r) => r.status() >= 400 && log.push(`[http ${r.status()}] ${r.url()}`))
  return { ctx, page, log }
}
const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') })
const ready = (page) => page.waitForFunction(() => window.__marsx?.ready === true, null, { timeout: 300000 })

if (which === 'all' || which === 'intro') {
  const { ctx, page, log } = await ctxPage({ width: 1440, height: 900 })
  await page.goto(U + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500); await shot(page, 'd-intro-1s')
  await ready(page)
  await shot(page, 'd-ready'); await page.waitForTimeout(2500); await shot(page, 'd-ready+2.5s'); await page.waitForTimeout(6000); await shot(page, 'd-ready+8s')
  say('intro: Skip buttons', await page.getByRole('button', { name: /skip/i }).count(), 'title text', (await page.locator('body').innerText()).slice(0, 160).replace(/\n+/g, ' | '))
  say('csp', JSON.stringify(await page.evaluate(() => window.__csp ?? [])), 'log', JSON.stringify(log))
  await ctx.close()
}

if (which === 'all' || which === 'tour') {
  const { ctx, page, log } = await ctxPage({ width: 1440, height: 900 })
  await page.goto(U + '/?tour=1', { waitUntil: 'domcontentloaded' })
  await ready(page)
  const card = page.getByRole('region', { name: 'Guided mission' })
  await card.waitFor({ timeout: 60000 })
  for (let i = 1; i < 5; i++) { await card.getByRole('button', { name: /^Next/ }).click(); await page.waitForTimeout(1500) }
  await shot(page, 'd-tour-step5')
  const btn = page.getByRole('button', { name: 'Open scorecard' }).first()
    await btn.waitFor({ timeout: 120000 }).catch(() => {})
  await btn.evaluate((e) => e.click()).catch((e) => say('click failed', e.message))
  const dlg = page.getByRole('dialog')
  const t0 = Date.now()
  try {
    await dlg.getByText(/Verified by re-simulation: 798 of 800/).waitFor({ timeout: 240000 })
    say('tour scorecard verified after', Date.now() - t0, 'ms; Does not pass count', await dlg.getByText('Does not pass').count())
  } catch { say('tour scorecard: verified text NOT found:', (await dlg.innerText().catch(() => 'no dialog')).slice(0, 400).replace(/\n+/g, ' | ')) }
  await shot(page, 'd-tour-scorecard')
  await page.keyboard.press('Escape')
  say('tour csp', JSON.stringify(await page.evaluate(() => window.__csp ?? [])), 'log', JSON.stringify(log))
  await ctx.close()
}

async function plan(page, pts) {
  if (!(await page.getByRole('radio', { name: /Astronaut/ }).first().isVisible().catch(() => false))) await page.locator('nav[aria-label="Modes"] button[data-mode="mission"]').locator('visible=true').first().click()
  const dismiss = page.getByRole('button', { name: 'Dismiss tips' })
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click()
  const box = await page.locator('canvas').first().boundingBox()
  for (const [fx, fy] of pts) { await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await page.waitForTimeout(700) }
  await page.getByText('Max slope', { exact: true }).first().or(page.getByRole('alert').filter({ hasText: /No route|error/i })).first().waitFor({ timeout: 120000 })
}

if (which === 'all' || which === 'watch') {
  for (const profile of (process.env.PROFILES ?? 'Rover RTG,Astronaut').split(',')) {
    const tag = profile.startsWith('A') ? 'astro' : 'rover'
    const { ctx, page, log } = await ctxPage({ width: 1440, height: 900 })
    await page.goto(U + '/', { waitUntil: 'domcontentloaded' }); await ready(page); await page.waitForTimeout(3000)
    if (profile === 'Astronaut') {
      await page.locator('nav[aria-label="Modes"] button[data-mode="mission"]').locator('visible=true').first().click()
      await page.getByRole('radio', { name: /Astronaut/ }).or(page.getByRole('button', { name: /Astronaut/ })).first().click().catch((e) => say('astronaut select failed', e.message.slice(0, 80)))
    }
    await plan(page, tag === 'astro' ? [[0.42, 0.6], [0.5, 0.52]] : [[0.3, 0.6], [0.5, 0.45]])
    await page.waitForTimeout(1500)
    await shot(page, `d-${tag}-planned`)
    const w = page.getByRole('button', { name: 'Watch route' })
    say(tag, 'Watch route button', await w.count())
    await w.click()
    await page.waitForTimeout(2500); await shot(page, `d-${tag}-watch-1x`)
    for (const sp of ['4', '16']) {
      await page.getByRole('radio', { name: sp + '×', exact: true }).click(); await page.waitForTimeout(2500); await shot(page, `d-${tag}-watch-${sp}x`)
    }
    await page.getByRole('button', { name: /^Follow/ }).click().catch(() => page.keyboard.press('Digit3'))
    for (const sp of ['1', '4', '16']) {
      await page.getByRole('radio', { name: sp + '×', exact: true }).click(); await page.waitForTimeout(3500); await shot(page, `d-${tag}-follow-${sp}x`)
    }
    const sl = page.getByRole('slider', { name: 'Playback position' })
    await sl.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(1200); await shot(page, `d-${tag}-follow-start`)
    await page.keyboard.press('End'); await page.waitForTimeout(1500); await shot(page, `d-${tag}-follow-end`)
    await page.getByRole('button', { name: /Exit Watch/ }).click(); await page.waitForTimeout(1500); await shot(page, `d-${tag}-exit`)
    say(tag, 'csp', JSON.stringify(await page.evaluate(() => window.__csp ?? [])), 'log', JSON.stringify(log))
    await ctx.close()
  }
}

if (which === 'all' || which === 'mobile') {
  const { ctx, page, log } = await ctxPage({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await page.goto(U + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500); await shot(page, 'm-intro-1s')
  await ready(page); await page.waitForTimeout(3000); await shot(page, 'm-ready')
  await page.locator('nav[aria-label="Modes"] button[data-mode="explore"]').locator('visible=true').first().click().catch(() => {})
  await page.waitForTimeout(800); await shot(page, 'm-explore-sheet')
  const handle = page.getByRole('button', { name: /Expand panel|Collapse panel/ }).first()
  for (const n of ['half', 'full', 'half2']) {
    if (await handle.count()) { await handle.click(); await page.waitForTimeout(900) }
    await shot(page, 'm-sheet-' + n)
  }
  const mm = page.getByRole('button', { name: /minimap/i }).first()
  say('minimap button', await mm.count())
  if (await mm.count()) { await mm.click(); await page.waitForTimeout(900); await shot(page, 'm-minimap-open') }
  say('mobile overflow', await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth))
  say('mobile csp', JSON.stringify(await page.evaluate(() => window.__csp ?? [])), 'log', JSON.stringify(log))
  await ctx.close()
}
await browser.close()
