import { expect, test } from '@playwright/test'

test('heatmap column geometry', async ({ page }) => {
  await page.goto('./')
  await page.getByLabel('Display name').fill('Mb')
  await page.getByRole('radio', { name: /Negative occurrence/i }).click()
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await expect(page.getByRole('button', { name: /Log event/i }).first()).toBeVisible()

  const geo = await page.evaluate(() => {
    const cell = document.querySelector('[data-heat-date]')!
    const week = cell.parentElement!.parentElement!   // cellWrap -> week
    const grid = week.parentElement!
    const labels = grid.firstElementChild!
    const weeks = [...grid.children].slice(1)
    const describe = (el: Element) => {
      const r = el.getBoundingClientRect()
      const last = el.lastElementChild!.getBoundingClientRect()
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height),
        lastChildBottom: Math.round(last.bottom),
        gapBelowLastChild: Math.round(r.bottom - last.bottom),
      }
    }
    const scrollerEl = (() => { let n: Element | null = grid; while (n && getComputedStyle(n).overflowX !== 'auto') n = n.parentElement; return n! })()
    return {
      labels: describe(labels),
      firstWeek: describe(weeks[0]!),
      lastWeek: describe(weeks[weeks.length - 1]!),
      weekTabHeights: weeks.map((w) => Math.round(w.firstElementChild!.getBoundingClientRect().height)),
      labelSpacerH: Math.round(labels.firstElementChild!.getBoundingClientRect().height),
      scroller: { h: Math.round(scrollerEl.getBoundingClientRect().height), clientH: scrollerEl.clientHeight, scrollH: scrollerEl.scrollHeight },
    }
  })
  console.log(JSON.stringify(geo, null, 2))
})
