import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { dismissTips, expectClean, isMobile, modeButton, open, watch } from './helpers'

/**
 * Plan a route wizard with real taps on the phone project and clicks on desktop. The order is
 * Who -> Driver -> (How, AI only) -> Start -> Goal -> (Options, astronaut) -> Review -> journey (immersive) -> Exit.
 */
async function tapAt(page: Page, info: TestInfo, x: number, y: number) {
  if (isMobile(info)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

test.describe('plan a route wizard', () => {
  test('who and driver first, then A and B, options, review, journey, exit, and back without losing the points', async ({ page, baseURL }, info) => {
    test.setTimeout(420_000)
    const issues = watch(page, baseURL!)
    await open(page)
    await dismissTips(page)
    const mobile = isMobile(info)
    const nav = modeButton(page, info, 'Plan a route')
    if (mobile) await nav.tap()
    else await nav.click()

    const cont = page.getByRole('button', { name: 'Continue' })
    const dot = (n: number, label: string) => page.getByRole('button', { name: new RegExp(`^${n}\\. ${label}`) })
    const reviewDot = () => page.getByRole('button', { name: /^\d\. Review/ })

    // 1. Who travels comes first (nothing on the map yet): pick the astronaut
    await expect(page.getByRole('radio', { name: /Rover RTG/ })).toBeChecked()
    await page.getByRole('radio', { name: /Astronaut/ }).click()
    await cont.click()
    // 2. Who drives: the A* plan is the default; an AI would add the How step
    await expect(page.getByRole('radio', { name: /A\* plan/ })).toBeChecked()
    await cont.click()

    // 3. Mark the map: banner asks for START, on a phone the sheet steps aside
    const banner = page.getByRole('status').filter({ hasText: 'Tap the map to set' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('START')
    if (mobile) await expect(page.locator('aside[aria-label="Inspector"]')).toHaveCount(0)
    const box = (await page.locator('canvas').first().boundingBox())!
    const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy]

    // a double tap / double click (the camera's fly-to) never places a point
    const [dx, dy] = at(0.4, 0.55)
    await page.mouse.dblclick(dx, dy)
    await page.waitForTimeout(700)
    await expect(banner).toContainText('START')

    await tapAt(page, info, ...at(0.3, 0.6))
    await expect(banner).toContainText('GOAL')
    await banner.getByRole('button', { name: 'Back' }).click()
    await expect(banner).toContainText('START')
    await tapAt(page, info, ...at(0.3, 0.6))
    await expect(banner).toContainText('GOAL')

    // a goal on top of the start is refused with a short message, and the Goal step stays open
    await page.waitForTimeout(400)
    await tapAt(page, info, ...at(0.3, 0.6))
    await expect(page.getByRole('alert').filter({ hasText: 'Pick a goal farther from the start' })).toBeVisible()
    await expect(banner).toContainText('GOAL')

    // 4. tap B -> the astronaut's optional step, with Skip (a stray map tap there changes nothing)
    await tapAt(page, info, ...at(mobile ? 0.7 : 0.55, 0.4))
    const skip = page.getByRole('button', { name: 'Skip' })
    await expect(skip).toBeVisible({ timeout: 90_000 })
    await tapAt(page, info, ...at(0.5, 0.3))
    await expect(skip).toBeVisible()
    await skip.click()
    // the astronaut's 15 degree limit may leave no safe route between these points: Review then says why instead of the numbers
    await expect(page.getByText('Mission time').or(page.getByRole('alert')).first()).toBeVisible({ timeout: 90_000 })

    // 5. back through the stepper to Who: the points are still there. A rover goes straight to Review ("Keep A and B")
    await dot(1, 'Who').dispatchEvent('click')
    await page.getByRole('radio', { name: /Rover RTG/ }).click()
    await cont.click() // driver
    await cont.click() // start (A* plan: no How step)
    await expect(banner).toContainText('START')
    await banner.getByRole('button', { name: 'Keep A and B' }).click()
    await expect(page.getByText('Mission time')).toBeVisible({ timeout: 90_000 })

    // 6. an AI driver adds the How step; the summary line and the stepper change it without touching A and B
    await expect(page.getByRole('button', { name: /A\* plan · Rover RTG/ })).toBeVisible()
    await page.getByRole('button', { name: /Change the driver/ }).dispatchEvent('click')
    await expect(page.getByRole('radio', { name: /A\* plan/ })).toBeVisible()
    const ref = page.getByRole('radio', { name: /Reference AI/ }).first()
    if (await ref.isEnabled()) {
      await ref.dispatchEvent('click')
      await expect(dot(3, 'How')).toBeVisible()
      await dot(3, 'How').dispatchEvent('click')
      await page.getByRole('radio', { name: /Free/ }).dispatchEvent('click')
      await reviewDot().dispatchEvent('click')
      await expect(page.getByRole('button', { name: /Reference AI · Free · Rover RTG/ })).toBeVisible()
      await page.getByRole('button', { name: /Change the driver/ }).dispatchEvent('click')
    }
    await page.getByRole('radio', { name: /A\* plan/ }).click()
    await reviewDot().dispatchEvent('click')
    await expect(page.getByText('Mission time')).toBeVisible()

    // 7. Start the journey: Follow with the minimal interface (no rail, no sheet, no minimap), Exit returns to Review
    const start = page.getByRole('button', { name: /Start the journey/ })
    if (!(await start.isEnabled())) {
      await expect(page.getByRole('alert')).toContainText('No route')
      expectClean(issues)
      return
    }
    if (mobile) await start.tap()
    else await start.click()
    const exit = page.getByRole('button', { name: /Exit/ }).first()
    await expect(exit).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('aside[aria-label="Inspector"]')).toHaveCount(0)
    await expect(page.locator('nav[aria-label="Modes"]').locator('visible=true')).toHaveCount(0)
    await expect(page.getByLabel(/Minimap/)).toHaveCount(0)
    if (mobile) await exit.tap()
    else await exit.click()
    await expect(page.getByText('Mission time')).toBeVisible({ timeout: 30_000 })
    await expect(start).toBeVisible()
    expectClean(issues)
  })
})
