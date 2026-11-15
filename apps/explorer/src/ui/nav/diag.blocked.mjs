/** How many cells of the A* route are blocked for env-lite (the policy's world)? node src/ui/nav/diag.blocked.mjs */
import { chromium } from 'playwright'
const browser = await chromium.launch({ channel: 'chrome', args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-webgl'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.addInitScript(() => (localStorage.setItem('marsx.onboarded', '1')))
await page.goto('http://localhost:5193/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__marsx?.ready === true && window.__marsx.agent, null, { timeout: 180000 })
const res = await page.evaluate(async () => {
  const m = window.__marsx.mission
  const { loadSimTerrain } = await import('/src/features/replay/sim-terrain.ts')
  const { costMap } = await import('/src/intelligence/sim/env-lite.ts')
  const { configFor } = await import('/src/features/replay/verify.ts')
  const { worldToCell } = await import('/src/core/mission/geometry.ts')
  const ds = (await import('/src/store/app.ts')).useApp.getState().dataset
  const terr = await loadSimTerrain(ds)
  const cfg = configFor('jezero-v1/l1/rtg-geometry')
  const cost = costMap(terr, cfg.maxSlopeDeg, cfg.maxStepM)
  const rows = []
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  m.setMissionProfile('rover-rtg')
  for (let i = 0; i < 10; i++) {
    const a = { x: -500 + rnd() * 1000, z: -500 + rnd() * 1000 }
    const ang = rnd() * 6.28, len = 250 + rnd() * 250
    const b = { x: a.x + Math.cos(ang) * len, z: a.z + Math.sin(ang) * len }
    await m.setMissionEndpoints(a, b)
    for (let k = 0; k < 120; k++) { await new Promise((r) => setTimeout(r, 250)); const o = m.state().outcomes['rover-rtg']; if (o) break }
    const o = m.state().outcomes['rover-rtg']
    if (!o || o.status !== 'ok') { rows.push({ i, status: o?.status }); continue }
    const g = m.state().layers.grid
    let blocked = 0, startBlocked = false, goalBlocked = false
    o.path.forEach((p, j) => { const c = worldToCell(g, p.x, p.z); const bl = !Number.isFinite(cost[c]); if (bl) blocked++; if (j === 0) startBlocked = bl; if (j === o.path.length - 1) goalBlocked = bl })
    rows.push({ i, n: o.path.length, blocked, startBlocked, goalBlocked })
  }
  return rows
})
console.log(res.map((r) => JSON.stringify(r)).join('\n'))
await browser.close()
