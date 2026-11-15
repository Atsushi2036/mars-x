/**
 * Captures + behavioural checks for the 3D navigation widgets (UX package B), real GPU (system Chrome).
 * Usage: node src/ui/nav/shots.nav.mjs [--url http://localhost:5193] [--vp desktop,mobile] [--theme dark,light] [--fps]
 * Output: apps/explorer/.shots/redesign/B/<name>__<desktop|mobile>__<dark|light>.png and report.json
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
const URL_BASE = arg('url', 'http://localhost:5193')
const THEMES = arg('theme', 'dark,light').split(',')
const VPS = arg('vp', 'desktop,mobile').split(',')
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
}
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const report = []
for (const vpName of VPS) {
  const vp = VIEWPORTS[vpName]
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor })
    await ctx.addInitScript((t) => {
      localStorage.setItem('marsx.theme', t)
      localStorage.setItem('marsx.onboarded', '1')
    }, theme)
    const page = await ctx.newPage()
    const errors = []
    page.on('console', (m) => ['error'].includes(m.type()) && errors.push(`[${m.type()}] ${m.text()}`))
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
    const checks = []
    const check = (name, ok, extra = '') => {
      checks.push({ name, ok: !!ok, extra })
      if (!ok) console.log(`  FAIL ${vpName}/${theme}: ${name} ${extra}`)
    }
    await page.goto(`${URL_BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.nav, null, { timeout: 180000 })
    const shot = async (name, wait = 900) => {
      await page.waitForTimeout(wait)
      await page.screenshot({ path: path.join(out, `${name}__${vpName}__${theme}.png`) })
    }
    const nav = (fn, a) => page.evaluate(({ f, a }) => new Function('n', 'a', `return (${f})(n, a)`)(window.__marsx.nav, a), { f: fn.toString(), a })
    const overlap = async () =>
      page.evaluate(() => {
        const boxes = []
        const add = (name, el) => {
          const r = el?.getBoundingClientRect()
          if (r && r.width > 0 && r.height > 0) boxes.push({ name, l: r.left, t: r.top, r: r.right, b: r.bottom })
        }
        add('dock', document.querySelector('[role=toolbar][aria-label=Camera]'))
        add('watchbar', document.querySelector('[role=group][aria-label=Playback]'))
        add('zoom', document.querySelector('[role=group][aria-label="Map controls"]'))
        add('minimap', document.querySelector('canvas[role=application]')?.parentElement)
        add('layers', [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Layers'))
        const chrome = []
        for (const [n, sel] of [['topbar', '[data-chrome=top]'], ['inspector', '[data-chrome=side]'], ['telemetry', '[role=status][aria-label=Telemetry]']]) {
          const el = document.querySelector(sel)
          const r = el?.getBoundingClientRect()
          if (r && r.width > 0) chrome.push({ name: n, l: r.left, t: r.top, r: r.right, b: r.bottom })
        }
        const hit = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5
        const bad = []
        for (const a of boxes) {
          for (const c of chrome) if (hit(a, c)) bad.push(`${a.name} x ${c.name}`)
          for (const b of boxes) if (a.name < b.name && hit(a, b)) bad.push(`${a.name} x ${b.name}`)
        }
        return bad
      })

    // 1. orbit, dock visible
    await page.getByRole('toolbar', { name: 'Camera' }).waitFor()
    for (const n of ['Orbit camera', 'Walk camera', 'Follow camera']) check(`dock button ${n}`, (await page.getByRole('button', { name: new RegExp(n) }).count()) === 1)
    check('hint shown on first view', await page.getByRole('status').filter({ hasText: /orbit|Drag/i }).first().isVisible().catch(() => false))
    await shot('01-orbit', 1200)
    check('no overlap orbit', (await overlap()).length === 0, (await overlap()).join(', '))

    // 2. zoom +/- ~25 %
    const d0 = await nav((n) => n.rig.pose.dist)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.waitForTimeout(500)
    const d1 = await nav((n) => n.rig.pose.dist)
    check('zoom in shortens distance 20-30 %', d1 / d0 > 0.7 && d1 / d0 < 0.8, `ratio ${(d1 / d0).toFixed(2)}`)
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.waitForTimeout(500)
    const d2 = await nav((n) => n.rig.pose.dist)
    check('zoom out lengthens distance', d2 > d1 * 1.2, `${d1.toFixed(0)} -> ${d2.toFixed(0)}`)

    // 3. compass + home
    if (vpName === 'desktop') {
      await page.keyboard.press('KeyE')
      await page.keyboard.down('KeyE')
      await page.waitForTimeout(500)
      await page.keyboard.up('KeyE')
      const az = await nav((n) => n.rig.azimuth)
      check('Q/E rotates the heading', Math.abs(az) > 0.2, `az ${az.toFixed(2)}`)
      await shot('02-rotated', 300)
    }
    await page.getByRole('button', { name: /Compass/ }).click()
    await page.waitForTimeout(700)
    check('compass click restores north up', Math.abs(await nav((n) => n.rig.azimuth)) < 0.05)
    await page.getByRole('button', { name: /Home view/ }).click()
    await page.waitForTimeout(1500)
    const dh = await nav((n) => n.rig.pose.dist)
    const home = await nav((n) => n.rig.homePose.dist)
    check('Home restores the opening distance', Math.abs(dh - home) / home < 0.03, `${dh.toFixed(0)} vs ${home.toFixed(0)}`)

    // 4. minimap click flies there
    const mm = page.getByRole('application', { name: /Minimap/ })
    if (vpName === 'mobile') {
      await page.getByRole('button', { name: 'Open minimap' }).click()
      await shot('03-minimap-open', 500)
    }
    const box = await mm.boundingBox()
    await mm.click({ position: { x: box.width * 0.8, y: box.height * 0.25 } })
    await page.waitForTimeout(1200)
    const foc = await nav((n) => ({ x: n.rig.focus.x, z: n.rig.focus.z }))
    check('minimap click moves the target to the NE quadrant', foc.x > 100 && foc.z < -100, JSON.stringify(foc))
    await shot('04-minimap-fly', 300)
    if (vpName === 'mobile') await page.getByRole('button', { name: 'Close minimap' }).click()

    // 5. double click/tap flies (desktop uses the mouse, mobile taps)
    await page.getByRole('button', { name: /Home view/ }).click()
    await page.waitForTimeout(1500)
    const before = await nav((n) => ({ x: n.rig.focus.x, z: n.rig.focus.z, dist: n.rig.pose.dist }))
    const cx = vp.width / 2 - 40
    const cy = vp.height * 0.42
    if (vpName === 'desktop') await page.mouse.dblclick(cx, cy)
    else {
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(90)
      await page.touchscreen.tap(cx, cy)
    }
    await page.waitForTimeout(1300)
    const after = await nav((n) => ({ x: n.rig.focus.x, z: n.rig.focus.z, dist: n.rig.pose.dist }))
    check('double click flies closer to the point', after.dist < before.dist * 0.7 && Math.hypot(after.x - before.x, after.z - before.z) > 20, JSON.stringify({ before, after }))
    await shot('05-dblclick', 200)

    // 6. modes via keys: walk, follow without route
    await page.keyboard.press('Digit2')
    await page.waitForTimeout(700)
    check('key 2 -> Walk', (await nav((n) => n.camera.getState().mode)) === 'fpv')
    check('Walk pressed state', (await page.getByRole('button', { name: /Walk camera/ }).getAttribute('aria-pressed')) === 'true')
    await shot('06-walk', 1500)
    await page.keyboard.press('Digit3')
    await page.waitForTimeout(900)
    check('Follow without a route offers Plan a route', await page.getByText('Plan a route first').isVisible().catch(() => false))
    await shot('07-follow-noroute', 800)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    check('Esc returns to Orbit', (await nav((n) => n.camera.getState().mode)) === 'orbit')

    // 7. plan a route, Watch
    const ok = await page.evaluate(async () => {
      const m = window.__marsx.mission
      m.setMissionProfile('rover-rtg')
      await m.setMissionEndpoints({ x: -120, z: 90 }, { x: 160, z: -110 })
      for (let i = 0; i < 200; i++) {
        const st = m.state()
        if (st.outcomes['rover-rtg']?.status === 'ok') return true
        await new Promise((r) => setTimeout(r, 250))
      }
      return false
    })
    check('route planned', ok)
    const watch = page.getByRole('button', { name: /^Watch route/ })
    await watch.waitFor({ timeout: 8000 }).catch(() => {})
    check('Watch route button appears', await watch.isVisible().catch(() => false))
    await page.keyboard.press('Digit1')
    await shot('08-watch-button', 900)
    check('no overlap with Watch button', (await overlap()).length === 0, (await overlap()).join(', '))
    await watch.click()
    await page.waitForTimeout(900)
    check('Watch enters Follow', (await nav((n) => n.camera.getState().mode)) === 'chase')
    check('playback bar visible', await page.getByRole('group', { name: 'Playback' }).isVisible())
    await shot('09-watching', 1500)
    check('no overlap while watching', (await overlap()).length === 0, (await overlap()).join(', '))
    const t1 = await nav((n) => n.playback.getState().t)
    await page.getByRole('radio', { name: '4×' }).click()
    await page.waitForTimeout(1200)
    const t2 = await nav((n) => n.playback.getState().t)
    check('4x advances faster than 1x would', t2 - t1 > 3, `dt ${(t2 - t1).toFixed(1)} s in 1.2 s`)
    await page.keyboard.press('Space')
    await page.waitForTimeout(400)
    const p1 = await nav((n) => n.playback.getState().t)
    await page.waitForTimeout(800)
    const p2 = await nav((n) => n.playback.getState().t)
    check('Space pauses', Math.abs(p2 - p1) < 0.5 && !(await nav((n) => n.playback.getState().playing)), `${p1.toFixed(1)} ${p2.toFixed(1)}`)
    await shot('10-paused', 200)
    // scrub
    const slider = page.getByRole('slider', { name: 'Playback position' })
    await slider.focus()
    await page.keyboard.press('Home')
    await page.waitForTimeout(500)
    check('scrubber seeks to the start', (await nav((n) => n.playback.getState().t)) < 1)
    await page.getByRole('button', { name: /Exit Watch/ }).click()
    await page.waitForTimeout(600)
    check('Exit returns to the previous camera', (await nav((n) => n.camera.getState().mode)) === 'orbit' && (await nav((n) => n.playback.getState().source)) === null)

    // 8. help
    await page.getByRole('button', { name: /Controls help/ }).click()
    await shot('11-help', 500)
    check('help dialog open', await page.getByRole('dialog').isVisible())
    await page.keyboard.press('Escape')

    // 8b. inspector open (desktop side card / phone sheet): widgets must keep clear of it, in every sheet height
    await page.getByRole('button', { name: vpName === 'desktop' ? /Plan a route/ : /^Plan$/ }).first().click()
    await page.waitForTimeout(1200)
    await shot('12-inspector-open', 500)
    check('no overlap with the inspector open', (await overlap()).length === 0, (await overlap()).join(', '))
    check('dock still visible with the inspector open', await page.getByRole('toolbar', { name: 'Camera' }).isVisible())
    if (vpName === 'mobile') {
      const handle = page.getByRole('button', { name: /Expand panel/ })
      if (await handle.count()) {
        await handle.click()
        await page.waitForTimeout(900)
        await shot('13-sheet-half', 300)
        check('no overlap with the sheet half open', (await overlap()).length === 0, (await overlap()).join(', '))
      }
    }

    // 9. fps
    if (process.argv.includes('--fps')) {
      await page.waitForTimeout(1500)
      const fps = await page.evaluate(() => new Promise((res) => {
        let n = 0
        const t0 = performance.now()
        const f = () => (performance.now() - t0 < 4000 ? (n++, requestAnimationFrame(f)) : res(n / 4))
        requestAnimationFrame(f)
      }))
      check('fps measured', true, `${fps.toFixed(1)} fps`)
      const perf = await nav((n) => ({ ms: n.miniPerf.ms / Math.max(1, n.miniPerf.n), n: n.miniPerf.n }))
      check('minimap draw cost under 0.5 ms per frame', (perf.ms * 15) / 60 < 0.5, perf.ms.toFixed(3) + ' ms per draw at 15 Hz')
      report.push({ vp: vpName, theme, fps, perf })
    }
    // meaningful console errors only
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
    report.push({ vp: vpName, theme, checks, errors })
    console.log(`${vpName}/${theme}: ${checks.filter((c) => c.ok).length}/${checks.length} ok`)
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1))
