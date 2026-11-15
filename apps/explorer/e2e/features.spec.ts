import path from 'node:path'
import { expect, test } from '@playwright/test'
import { cspViolations, expectClean, isMobile, modeButton, open, watch } from './helpers'

const EXAMPLE_RUN = path.resolve(import.meta.dirname, '../../../bench/jezero-v1/baselines/example.run.json')
const TITLES = ['Real Jezero terrain', 'Mars conditions', 'Marswalk', 'Rover: one plan per sol', 'Bring your own AI', 'Graduate to a full simulator']

test.describe('guided tour (?tour=1)', () => {
  test('6 steps: Next, Back and Esc', async ({ page, baseURL }) => {
    test.setTimeout(600_000)
    const issues = watch(page, baseURL!)
    await open(page, 'dark', 'tour=1')
    const card = page.getByRole('region', { name: 'Guided mission' })
    await expect(card).toBeVisible({ timeout: 60_000 })
    for (let i = 0; i < TITLES.length; i++) {
      await expect(card.getByText(`step ${i + 1} of 6`)).toBeVisible({ timeout: 60_000 })
      await expect(card.getByRole('heading', { name: TITLES[i]! })).toBeVisible()
      if (i < TITLES.length - 1) await card.getByRole('button', { name: /^Next/ }).click()
    }
    await expect(card.getByRole('button', { name: 'Finish' })).toBeVisible()
    await card.getByRole('button', { name: 'Back' }).click()
    await expect(card.getByRole('heading', { name: TITLES[4]! })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
    expectClean(issues)
  })
})

test.describe('AI Lab', () => {
  test('reference policy is published and loads with one click from the catalog', async ({ page, baseURL }, info) => {
    test.setTimeout(600_000)
    const issues = watch(page, baseURL!)
    await open(page)
    await modeButton(page, info, 'AI Lab').click()
    await page.getByRole('tab', { name: 'Bring your model' }).or(page.getByRole('radio', { name: /Bring your model/ })).or(page.getByRole('button', { name: 'Bring your model' })).first().click()
    await expect(page.getByRole('heading', { name: 'Try a model' })).toBeVisible()
    await expect(page.getByText(/model catalog is not published/i)).toHaveCount(0)
    const load = page.getByRole('listitem').filter({ hasText: 'PPO reference' }).getByRole('button', { name: 'Load model' })
    await load.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await expect(load).toBeEnabled({ timeout: 30_000 })
    await load.click()
    await expect(page.getByRole('button', { name: 'Remove the policy' })).toBeVisible({ timeout: 180_000 })
    // zod 4 probes Function() once at startup; the blocked probe is reported as script-src eval and is harmless
    expect((await cspViolations(page)).filter((v) => !v.startsWith('script-src eval')), 'CSP violations while loading ONNX').toEqual([])
    expectClean(issues)
  })

  test('example run.json -> scorecard: verified by re-simulation, L2 does not pass', async ({ page }, info) => {
    test.setTimeout(900_000)
    await open(page)
    await modeButton(page, info, 'AI Lab').click()
    await page.getByRole('radio', { name: /Bring your model/ }).click()
    await page.locator('input[type="file"][accept*="json"]').setInputFiles(EXAMPLE_RUN, { timeout: 30_000 })
    const openBtn = page.getByRole('button', { name: 'Open scorecard' })
    await openBtn.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await openBtn.click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByText(/Verified by re-simulation: 798 of 800/)).toBeVisible({ timeout: 600_000 })
    await expect(dlg.getByText('Does not pass').locator('visible=true').first()).toBeVisible()
  })
})

test.describe('platform checks', () => {
  test('response headers: page CSP and the policy worker CSP', async ({ request }) => {
    const res = await request.get('/')
    const csp = res.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("connect-src 'self' blob:")
    expect(csp).toContain("object-src 'none'")
    expect(res.headers()['cross-origin-opener-policy']).toBe('same-origin')
    const html = await res.text()
    const entry = html.match(/assets\/index-[\w-]+\.js/)?.[0]
    expect(entry).toBeTruthy()
    // the worker is referenced from whichever lazy chunk imports it: scan the entry and the chunks it names
    const entryJs = await (await request.get(`/${entry}`)).text()
    const chunks = [...new Set(entryJs.match(/[\w-]+-[\w-]{8}\.js/g) ?? [])]
    let w = entryJs.match(/policy\.worker-[\w-]+\.js/)?.[0]
    for (const c of chunks) {
      if (w) break
      w = (await (await request.get(`/assets/${c}`)).text()).match(/policy\.worker-[\w-]+\.js/)?.[0]
    }
    expect(w, 'policy worker referenced from the entry bundle or its chunks').toBeTruthy()
    const wr = await request.get(`/assets/${w}`)
    expect(wr.status()).toBe(200)
    expect(wr.headers()['content-security-policy']).toContain("connect-src 'none'")
  })

  test('data assets answer with their real content type (no SPA fallback)', async ({ request }) => {
    for (const [p, ct] of [['manifest.json', 'json'], ['models/policy-card.json', 'json'], ['models/policy.onnx', 'octet'], ['baselines/example.run.json', 'json']] as const) {
      const r = await request.get(`/data/jezero-v1/${p}`)
      expect(r.status(), p).toBe(200)
      expect(r.headers()['content-type'], p).toContain(ct)
    }
  })

  test('desktop inspector scrolls with the mouse wheel', async ({ page }, info) => {
    test.skip(isMobile(info), 'desktop panel')
    await open(page)
    await modeButton(page, info, 'Data & Sources').click()
    const insp = page.locator('[aria-label="Inspector"]').first()
    await expect(insp).toBeVisible()
    await page.waitForTimeout(2000) // let the panel content settle before measuring
    const box = (await insp.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const sc = () =>
      insp.evaluate((el) => {
        const cands = [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))] as HTMLElement[]
        const s = cands.find((n) => n.scrollHeight > n.clientHeight + 4 && getComputedStyle(n).overflowY !== 'visible')
        return s ? { top: s.scrollTop, scrollable: s.scrollHeight - s.clientHeight } : null
      })
    const before = await sc()
    expect(before, 'a scrollable container exists in the inspector').not.toBeNull()
    await page.mouse.wheel(0, 600)
    // software GL (SwiftShader) keeps the main thread busy: give the wheel event time to be applied
    await expect.poll(async () => (await sc())?.top ?? 0, { timeout: 30_000, message: 'wheel moved the panel' }).toBeGreaterThan(before!.top)
  })

  test('Export panel with absent ZIPs says so (no broken links)', async ({ page, baseURL }, info) => {
    const issues = watch(page, baseURL!)
    await open(page)
    await modeButton(page, info, 'Data & Sources').click()
    const notice = page.getByText(/does not include export packages|No export packages/i).first()
    const links = page.getByRole('link', { name: /Download ZIP/ })
    await expect(notice.or(links.first())).toBeAttached({ timeout: 30_000 })
    for (const l of await links.all()) {
      const href = (await l.getAttribute('href'))!
      const r = await page.request.get(href)
      expect(r.status(), `export link ${href}`).toBe(200)
    }
    expectClean(issues)
  })
})
