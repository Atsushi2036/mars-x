import { expect, test } from '@playwright/test'
import { cspViolations, expectClean, modeButton, open, watch } from './helpers'

/** "Try a model": one click, no file picker. The catalog is published at models/catalog.json by the build. */
async function openBring(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo) {
  await modeButton(page, info, 'Test your AI').click()
  await page.getByRole('radio', { name: /Bring your model/ }).click()
  await expect(page.getByRole('heading', { name: 'Try a model' })).toBeVisible({ timeout: 60_000 })
}

test.describe('Try a model (catalog)', () => {
  test('catalog lists the reference and the example with honest official numbers', async ({ page }, info) => {
    await open(page)
    await openBring(page, info)
    const cards = page.getByRole('list', { name: 'Ready-made models' }).getByRole('listitem')
    await expect(cards).toHaveCount(2)
    const ref = cards.filter({ hasText: 'PPO reference' })
    await expect(ref.getByText('v0.2.0')).toBeVisible()
    await expect(ref.getByText('Does not pass L1')).toBeVisible()
    await expect(ref.getByText('fbb0bdfc')).toBeVisible()
    const ex = cards.filter({ hasText: 'Example student model (PPO, 1.5M steps)' })
    await expect(ex.getByText('Does not pass L1')).toBeVisible()
    await expect(ex.getByText('n = 600')).toBeVisible()
  })

  test('one click on Load model validates the ONNX ("Matches the policy/1 contract")', async ({ page, baseURL }, info) => {
    test.setTimeout(600_000)
    const issues = watch(page, baseURL!)
    await open(page)
    await openBring(page, info)
    const ex = page.getByRole('listitem').filter({ hasText: 'Example student model (PPO, 1.5M steps)' })
    await ex.getByRole('button', { name: 'Load model' }).click()
    await expect(page.getByText('Matches the policy/1 contract')).toBeVisible({ timeout: 180_000 })
    await expect(ex.getByRole('button', { name: 'Loaded' })).toBeDisabled()
    // zod 4 probes `Function('')` once at startup; the blocked probe is reported as script-src eval and is harmless
    expect((await cspViolations(page)).filter((v) => !v.startsWith('script-src eval')), 'CSP violations while loading ONNX').toEqual([])
    expectClean(issues)
  })

  test('one click on See its benchmark re-simulates the official run: "Verified by re-simulation"', async ({ page }, info) => {
    test.setTimeout(900_000)
    await open(page)
    await openBring(page, info)
    const ex = page.getByRole('listitem').filter({ hasText: 'Example student model (PPO, 1.5M steps)' })
    await ex.getByRole('button', { name: 'See its benchmark' }).click()
    await expect(page.getByText(/Verified by re-simulation/).first()).toBeVisible({ timeout: 600_000 })
    await page.getByRole('button', { name: 'Open scorecard' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByText('Does not pass').locator('visible=true').first()).toBeVisible()
  })

  test('the reference has no published run: its benchmark button is disabled and says why', async ({ page }, info) => {
    await open(page)
    await openBring(page, info)
    const ref = page.getByRole('listitem').filter({ hasText: 'PPO reference' })
    await expect(ref.getByRole('button', { name: 'See its benchmark' })).toBeDisabled()
    await expect(ref.getByText(/official run is not published/i)).toBeVisible()
  })
})
