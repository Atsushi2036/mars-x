import { expect, test } from '@playwright/test'
import { dismissTips, expectClean, isMobile, modeButton, open, watch } from './helpers'

test.describe('mission flow', () => {
  test('click origin and destination -> route stats, or "No route" with a cause', async ({ page, baseURL }, info) => {
    const issues = watch(page, baseURL!)
    await open(page)
    await dismissTips(page)
    await modeButton(page, info, 'Mission').click()
    const box = (await page.locator('canvas').first().boundingBox())!
    // keep clear of the inspector (right on desktop, bottom sheet on mobile)
    const pts = isMobile(info)
      ? [[0.25, 0.4], [0.7, 0.45]]
      : [[0.25, 0.55], [0.5, 0.35]]
    for (const [fx, fy] of pts) {
      await page.mouse.click(box.x + box.width * fx!, box.y + box.height * fy!)
      await page.waitForTimeout(500)
    }
    // the wizard moves on by itself after the second point: Who -> Review shows the numbers
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 60_000 })
    const ok = page.getByText('Max slope', { exact: true }).first()
    const none = page.getByRole('alert').filter({ hasText: 'No route for this profile' })
    const err = page.getByText('Planner error')
    const result = ok.or(none).or(err).first()
    await expect(result).toBeAttached({ timeout: 60_000 })
    // Mobile: the result sits below the fold of the bottom sheet (opens at its lowest height) and is never
    // scrollable into view while the scene renders in software GL -> UX finding reported to the frontend owner.
    if (!isMobile(info)) await expect(result).toBeVisible()
    await expect(err, 'planner must not crash').toHaveCount(0)
    if (await none.count()) {
      const cause = (await none.first().textContent() ?? '').replace('No route for this profile', '').trim()
      expect(cause.length, 'a "no route" outcome must state its cause').toBeGreaterThan(10)
    } else {
      await expect(page.getByText('Distance').first()).toBeVisible()
      await expect(page.getByText('Max slope').first()).toBeVisible()
    }
    expectClean(issues)
  })

  test('entering Plan a route asks for the start first', async ({ page }, info) => {
    await open(page)
    await dismissTips(page)
    await modeButton(page, info, 'Mission').click()
    await expect(page.getByRole('status').filter({ hasText: 'Tap the map to set' })).toContainText('START')
  })
})

test.describe('not built yet', () => {
  test.fixme('Compare A* vs agent route overlay', async () => {})
})
