import { expect, test } from '@playwright/test'
import { cspViolations, expectClean, isMobile, modeButton, open, watch } from './helpers'

/** Plan a route is a wizard (Who, Driver, How, Start, Goal, Options, Review): decide who travels and drives, tap A and B, then Review. */
test.describe('plan a route wizard', () => {
  test('Reference AI, Guided: tap A and B -> Review -> journey -> Exit', async ({ page, baseURL }, info) => {
    test.setTimeout(420_000)
    const issues = watch(page, baseURL!)
    await open(page)
    const tips = page.getByRole('button', { name: 'Dismiss tips' })
    if (await tips.isVisible().catch(() => false)) await tips.click()
    await modeButton(page, info, 'Mission').click()

    // Who travels (rover by default), then who drives: the Reference AI, guided by the planned waypoints
    const cont = page.getByRole('button', { name: 'Continue' }).first()
    await expect(cont).toBeVisible({ timeout: 60_000 })
    await cont.click()
    const ref = page.getByRole('radio', { name: /Reference AI/ }).first()
    await ref.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await ref.click()
    await cont.click()
    await page.getByRole('radio', { name: /Guided/ }).click()
    await cont.click()

    // mark the map
    const v = page.viewportSize()!
    const tap = async (fx: number, fy: number) => (isMobile(info) ? page.touchscreen.tap(v.width * fx, v.height * fy) : page.mouse.click(v.width * fx, v.height * fy))
    await tap(0.3, isMobile(info) ? 0.38 : 0.55)
    await page.waitForTimeout(1000)
    await tap(isMobile(info) ? 0.6 : 0.5, 0.45)

    // the route is planned once both ends are placed; the wizard goes on to Options (astronaut only) or Review
    const go = page.getByRole('button', { name: 'Start the journey' })
    for (let i = 0; i < 3 && !(await go.isVisible().catch(() => false)); i++) {
      await page.getByRole('button', { name: /^(Continue|Skip)$/ }).first().click({ timeout: 90_000 }).catch(() => {})
      await page.waitForTimeout(800)
    }
    await expect(go).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('button', { name: /Reference AI · Guided/ })).toBeVisible()
    await expect(page.getByText('Planner error')).toHaveCount(0)
    await go.click()
    await expect(page.getByRole('group', { name: 'Playback' })).toBeVisible({ timeout: 60_000 })
    // the AI either arrives or the card explains what happened
    await expect(page.getByText(/Reached the goal|Got stuck|did not reach|waypoints reached/i).first()).toBeVisible({ timeout: 180_000 })
    await page.getByRole('button', { name: /Exit/ }).first().click()
    await expect(page.getByRole('group', { name: 'Playback' })).toHaveCount(0)
    await expect(go).toBeVisible({ timeout: 30_000 }) // back to Review with the panel restored
    expect((await cspViolations(page)).filter((x) => !x.startsWith('script-src eval'))).toEqual([])
    expectClean(issues)
  })
})
