import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { dismissTips, expectClean, isMobile, modeButton, open, watch } from './helpers'

/**
 * Plan a route wizard with real taps on the phone project (touchscreen) and clicks on desktop:
 * Start -> Goal -> Who -> (Options, astronaut) -> Review -> journey with minimal UI -> Exit -> Back.
 */
async function tapAt(page: Page, info: TestInfo, x: number, y: number) {
  if (isMobile(info)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

test.describe('plan a route wizard', () => {
  test('tap A, tap B, pick who, skip options, start the journey, exit, go back', async ({ page, baseURL }, info) => {
    test.setTimeout(420_000)
    const issues = watch(page, baseURL!)
    await open(page)
    await dismissTips(page)
    const mobile = isMobile(info)
    const nav = modeButton(page, info, 'Plan a route')
    if (mobile) await nav.tap()
    else await nav.click()

    // 1. entering starts the wizard: banner asks for START, on a phone the sheet steps aside
    const banner = page.getByRole('status').filter({ hasText: 'Tap the map to set' })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('START')
    if (mobile) await expect(page.locator('aside[aria-label="Inspector"]')).toHaveCount(0)

    const box = (await page.locator('canvas').first().boundingBox())!
    const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy]

    // a double tap / double click (the camera's fly-to) never places a point
    const [dx, dy] = at(0.4, 0.55)
    // a real double click / double tap: two pointer sequences back to back
    await page.mouse.dblclick(dx, dy)
    await page.waitForTimeout(700)
    await expect(banner).toContainText('START')

    // 2. tap A -> asks for GOAL; Back returns to START without losing the page
    await tapAt(page, info, ...at(0.3, 0.6))
    await expect(banner).toContainText('GOAL')
    await banner.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(banner).toContainText('START')
    await tapAt(page, info, ...at(0.3, 0.6))
    await expect(banner).toContainText('GOAL')

    // a goal on top of the start is refused with a short message, and the Goal step stays open
    await page.waitForTimeout(400)
    await tapAt(page, info, ...at(0.3, 0.6))
    await expect(page.getByRole('alert').filter({ hasText: 'Pick a goal farther from the start' })).toBeVisible()
    await expect(banner).toContainText('GOAL')

    // 3. tap B -> Who: the panel is back with the three profiles; a stray map tap changes nothing
    await tapAt(page, info, ...at(mobile ? 0.7 : 0.55, 0.4))
    const cont = page.getByRole('button', { name: 'Continue' })
    await expect(cont).toBeVisible({ timeout: 90_000 })
    await expect(page.getByRole('radio', { name: /Rover RTG/ })).toBeChecked()
    await tapAt(page, info, ...at(0.5, 0.3))
    await expect(cont).toBeVisible()

    // 4. an astronaut gets the optional step, with Skip
    await page.getByRole('radio', { name: /Astronaut/ }).click()
    await cont.click()
    await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip' }).click()
    // the astronaut's 15 degree limit may leave no safe route between these two points: Review then says why instead of the numbers
    await expect(page.getByText('Mission time').or(page.getByRole('alert')).first()).toBeVisible({ timeout: 90_000 })

    // 5. back through the steps, then a rover straight to Review (no options)
    await page.getByRole('button', { name: 'Back', exact: true }).first().dispatchEvent('click') // options
    await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible()
    await page.getByRole('button', { name: 'Back', exact: true }).first().dispatchEvent('click') // who
    await expect(page.getByRole('radio', { name: /Rover RTG/ })).toBeVisible()
    await page.getByRole('radio', { name: /Rover RTG/ }).click()
    await cont.click()
    await expect(page.getByText('Mission time')).toBeVisible({ timeout: 90_000 })

    // 6. Start the journey: Follow with the minimal interface (no rail, no sheet, no minimap), Exit returns to Review
    const start = page.getByRole('button', { name: /Start the journey/ })
    if (!(await start.isEnabled())) {
      // this pair of points has no safe route for the profile: the review says why and offers Back
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
    await expect(page.getByRole('button', { name: /Start the journey/ })).toBeVisible()
    expectClean(issues)
  })
})
