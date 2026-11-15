/**
 * Success table of the live AI drive on real terrain: each model x mode x route, summary read from the driver store.
 * node src/ui/nav/measure.drive.mjs [--url http://localhost:5193] [--modes guided,free] [--models ppo-reference,my-first-model]
 */
import { chromium } from 'playwright'
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const base = arg('url', 'http://localhost:5193')
const MODES = arg('modes', 'guided,free').split(',')
const MODELS = arg('models', 'ppo-reference,my-first-model').split(',')
const ROUTES = [
  ['sample', [65, 9], [279, 221]],
  ['W-E', [-300, 200], [-120, 20]],
  ['long', [-400, 300], [100, 100]],
  ['S', [200, -200], [-100, -350]],
]
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => (localStorage.setItem('marsx.theme', 'dark'), localStorage.setItem('marsx.onboarded', '1')))
const page = await ctx.newPage()
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.agent, null, { timeout: 180000 })
const cat = await page.evaluate(async () => (await (await fetch('/data/jezero-v1/models/catalog.json')).json()).models)
await page.evaluate((m) => window.__marsx.agent.driver.setState({ catalog: m }), cat)
console.log('model | mode | route | outcome | reached/total | steps | m driven vs A* | stuck?')
for (const model of MODELS) for (const mode of MODES) {
  let ok = 0
  for (const [name, a, b] of ROUTES) {
    const res = await page.evaluate(async ([a, b, model, mode]) => {
      const A = window.__marsx.agent
      const m = window.__marsx.mission
      A.playback.getState().exit()
      m.setMissionProfile('rover-rtg')
      await m.setMissionEndpoints({ x: a[0], z: a[1] }, { x: b[0], z: b[1] })
      for (let k = 0; k < 240; k++) { if (m.state().outcomes['rover-rtg']?.status === 'ok') break; await new Promise((r) => setTimeout(r, 250)) }
      A.driver.setState({ kind: 'catalog:' + model, mode, notice: null, summary: null, phase: 'idle' })
      const { startJourney } = await import('/src/store/watch.ts')
      startJourney()
      for (let k = 0; k < 600; k++) { await new Promise((r) => setTimeout(r, 200)); if (A.driver.getState().phase === 'done') break }
      const s = A.driver.getState().summary
      const n = A.driver.getState().notice
      A.playback.getState().exit()
      return { s, n }
    }, [a, b, model, mode])
    const s = res.s
    if (s?.outcome === 'success') ok++
    console.log(`${model} | ${mode} | ${name} | ${s?.outcome ?? 'none (' + res.n + ')'} | ${s?.reached}/${s?.total} | ${s?.steps} | ${s ? Math.round(s.pathM) + ' vs ' + Math.round(s.astarM) : '-'}`)
  }
  console.log(`>> ${model} ${mode}: ${ok}/${ROUTES.length} reached`)
}
await browser.close()
