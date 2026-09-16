/**
 * End-to-end acceptance against the production build, served under the same
 * `/habit-quota/` base path GitHub Pages uses.
 *
 * These run in Chromium and WebKit (the engine iOS Safari uses) plus an iPhone
 * viewport, so the mobile layout and the laptop layout are both exercised.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_PATH = '/habit-quota/'
const BACKUP_DIR = 'test-results/backups'

async function completeOnboarding(page: Page, name = 'Violin practice'): Promise<void> {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()
  await page.getByLabel('Display name').fill(name)
  await page.getByRole('button', { name: 'Start tracking' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
}

/** A heatmap day cell whose accessible name ends with the given value. */
function dayCell(page: Page, value: string) {
  return page.locator(`button[data-heat-date][aria-label$=", ${value}"]`)
}

async function logMinutes(page: Page, minutes: 15 | 30 | 45 | 60): Promise<void> {
  await page
    .getByRole('button', { name: /Log practice/i })
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: `${minutes} min` }).click()
  await dialog.getByRole('button', { name: 'Save entry' }).click()
  await expect(dialog).toBeHidden()
}

/**
 * Every element whose right edge lies past the viewport, ignoring anything
 * inside a container that declares a horizontal scroller — those are the only
 * places sideways movement is intended.
 */
async function sidewaysOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (box.right <= limit + 0.5) continue
      let ancestor = el.parentElement
      let inScroller = false
      while (ancestor) {
        const overflowX = getComputedStyle(ancestor).overflowX
        if (overflowX === 'auto' || overflowX === 'scroll') {
          inScroller = true
          break
        }
        ancestor = ancestor.parentElement
      }
      if (inScroller) continue
      offenders.push(`<${el.tagName.toLowerCase()} class="${el.className}"> right=${Math.round(box.right)} of ${limit}`)
    }
    return offenders
  })
}


/**
 * Nothing inside a sheet may reach past its own edge. A sheet clips rather than
 * pans, so an over-wide field is invisible rather than merely awkward — the
 * measurement has to be made rather than looked at.
 */
async function expectSheetFits(page: Page, name: string): Promise<void> {
  const report = await page.getByRole('dialog').evaluate((sheet) => {
    const limit = sheet.getBoundingClientRect().right
    const past: string[] = []
    for (const node of Array.from(sheet.querySelectorAll('*'))) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (box.right <= limit + 0.5) continue
      past.push(`<${node.tagName.toLowerCase()}${node.id ? ` id="${node.id}"` : ''}> right=${Math.round(box.right)} of ${Math.round(limit)}`)
    }
    return { overflow: sheet.scrollWidth - sheet.clientWidth, past }
  })
  expect(report.overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(report.past, `${name} has content past its edge`).toEqual([])
}

test.describe('first run and daily use', () => {
  test('onboards, logs, and shows progress', async ({ page }) => {
    await completeOnboarding(page)

    // A brand-new habit starts empty and says so without scolding.
    await expect(page.getByText('Nothing recorded yet')).toBeVisible()
    await expect(page.getByText('No goal set')).toBeVisible()

    await logMinutes(page, 30)

    await expect(page.getByText('Today', { exact: true })).toBeVisible()
    await expect(page.getByText('Current streak', { exact: true })).toBeVisible()
    await expect(page.getByText('30 min added', { exact: false })).toBeVisible()

    // The heatmap cell for today now carries the value in its accessible name.
    await expect(dayCell(page, '30 min')).toBeVisible()
  })

  test('inspects a day and a week from the heatmap', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 45)

    const todayCell = dayCell(page, '45 min')
    await todayCell.click()

    const dayDetail = page.getByLabel('Day detail')
    await expect(dayDetail).toBeVisible()
    await expect(dayDetail.getByText('45 min').first()).toBeVisible()

    const weekSummary = page.getByLabel('Week summary')
    await expect(weekSummary).toBeVisible()
    await expect(weekSummary.getByText(/^Week \d+$/)).toBeVisible()
    await expect(weekSummary.getByText('45 min').first()).toBeVisible()
  })

  test('moves between heatmap days with the keyboard', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 30)

    const todayCell = dayCell(page, '30 min')
    await todayCell.focus()
    await page.keyboard.press('ArrowUp')

    const focusedDate = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.heatDate ?? null,
    )
    expect(focusedDate).not.toBeNull()
    await expect(page.getByLabel('Day detail')).toBeVisible()
  })

  test('edits an entry and previews the consequence first', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 30)

    await page.getByRole('link', { name: 'Timeline' }).first().click()
    await page.getByRole('button', { name: /Recorded/ }).first().click()
    await page.getByRole('button', { name: 'Edit entry' }).click()

    const dialog = page.getByRole('dialog', { name: 'Edit entry' })
    await dialog.locator('#entry-minutes').fill('60')

    // The consequence preview appears before anything is saved.
    await expect(dialog.getByText('If you save this change')).toBeVisible()
    await expect(dialog.getByText('30 min').first()).toBeVisible()
    await expect(dialog.getByText('1h', { exact: true }).first()).toBeVisible()

    // Saving is refused while the times still say 30 minutes.
    await dialog.getByRole('button', { name: 'Save change' }).click()
    await expect(
      dialog.getByText('Resolve the start and end times before saving.'),
    ).toBeVisible()

    await dialog.locator('#entry-end').fill('19:15')
    await dialog.getByRole('button', { name: 'Save change' }).click()
    await expect(dialog).toBeHidden()

    // The audit history records the change rather than replacing the original.
    await page.getByRole('tab', { name: 'Changes' }).click()
    await expect(page.getByText(/Duration changed from 30 to 60 minutes/)).toBeVisible()
    await expect(page.getByText('Entry created')).toBeVisible()
  })

  test('deletes with an Undo that restores the entry', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 30)

    await page.getByRole('link', { name: 'Timeline' }).first().click()
    await page.getByRole('button', { name: /Recorded/ }).first().click()
    await page.getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('Entry deleted', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Entry restored')).toBeVisible()
  })
})

test.describe('goals', () => {
  test('adds a weekly goal without visiting a Settings screen', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 60)

    await page.getByRole('button', { name: 'Add a goal' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a goal' })
    await dialog.getByRole('radio', { name: /Periodic minimum/ }).click()
    await dialog.getByLabel('Amount').fill('2')
    await dialog.getByRole('button', { name: 'Save goal' }).click()

    await expect(page.getByText('Weekly minimum')).toBeVisible()
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })
})

test.describe('data portability', () => {
  test('exports, moves to a fresh device, re-imports, and is idempotent', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'webkit',
      'Download interception is flaky in this WebKit build',
    )

    // Exercise the download fallback — the path iOS Safari and Firefox take.
    // The File System Access picker that desktop Chromium prefers opens a
    // native dialog no automated run can drive, so it is verified by hand.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window, 'showSaveFilePicker')
    })

    await completeOnboarding(page)
    await logMinutes(page, 45)

    await page.getByRole('link', { name: 'Data' }).first().click()
    await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
    await expect(page.getByText('No sequence gaps')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export backup' }).click()
    const exportDialog = page.getByRole('dialog', { name: 'Export backup' })
    await expect(exportDialog.getByText(/habit-backup-\d{4}-\d{2}-\d{2}\.json/)).toBeVisible()
    await exportDialog.getByRole('button', { name: /Download backup|Choose location/ }).click()

    const download = await downloadPromise
    const backupPath = `${BACKUP_DIR}/${testInfo.project.name}-backup.json`
    await download.saveAs(backupPath)
    await expect(page.getByText('Backup saved')).toBeVisible()

    // A second browser context is a second origin storage area: exactly what a
    // new device, or a profile whose site data was cleared, looks like.
    const freshContext = await browser.newContext({ baseURL: baseURL as string })
    const freshPage = await freshContext.newPage()
    try {
      await freshPage.goto('./')
      await expect(freshPage.getByRole('heading', { name: 'Habits' })).toBeVisible()

      await freshPage.getByRole('button', { name: 'Import a backup instead' }).click()
      await freshPage.getByLabel('Choose a backup file').setInputFiles(backupPath)

      await expect(freshPage.getByText('Nothing will be overwritten')).toBeVisible()
      await freshPage.getByRole('button', { name: /^Merge / }).click()
      await expect(freshPage.getByText('Merge complete')).toBeVisible()
      await freshPage.getByRole('button', { name: 'Done' }).click()

      // The habit and its entry came back intact.
      await freshPage.getByRole('link', { name: 'Home' }).first().click()
      await expect(freshPage.getByRole('button', { name: /Violin practice/ })).toBeVisible()
      await expect(dayCell(freshPage, '45 min')).toBeVisible()

      // Importing the very same file again adds nothing at all.
      await freshPage.getByRole('link', { name: 'Data' }).first().click()
      await freshPage.getByLabel('Choose a backup file').setInputFiles(backupPath)
      await expect(
        freshPage.getByText(/already fully present\. Merging it changes nothing/),
      ).toBeVisible()
    } finally {
      await freshContext.close()
    }
  })

  test('deletes every trace of the data and returns to onboarding', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 30)

    await page.getByRole('link', { name: 'Data' }).first().click()
    const startOver = page.getByLabel('Start over')
    await expect(startOver.getByRole('button', { name: 'Export a backup first' })).toBeVisible()
    await startOver.getByRole('button', { name: 'Delete all data' }).click()

    const dialog = page.getByRole('dialog', { name: 'Delete all data' })
    const confirm = dialog.getByRole('button', { name: 'Delete everything' })
    await expect(confirm).toBeDisabled()

    await dialog.getByLabel(/Type delete to confirm/i).fill('delete')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // Back to a genuine first run, not just an empty screen. The app recreates
    // the database on launch, so the thing to check is that it holds nothing.
    await expect(page.getByRole('heading', { name: 'Habits' })).toBeVisible()

    const counts = await page.evaluate(
      () =>
        new Promise<Record<string, number>>((resolve, reject) => {
          const request = indexedDB.open('habit-tracker-local-v1')
          request.onerror = () => reject(new Error('could not open the database'))
          request.onsuccess = () => {
            const database = request.result
            const stores = ['events', 'habitViews', 'entryViews']
            const tx = database.transaction(stores, 'readonly')
            const out: Record<string, number> = {}
            let pending = stores.length
            for (const store of stores) {
              const countRequest = tx.objectStore(store).count()
              countRequest.onsuccess = () => {
                out[store] = countRequest.result
                pending -= 1
                if (pending === 0) {
                  database.close()
                  resolve(out)
                }
              }
            }
          }
        }),
    )
    expect(counts).toEqual({ events: 0, habitViews: 0, entryViews: 0 })
  })

  test('refuses an unreadable file and leaves the database untouched', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 30)

    await page.getByRole('link', { name: 'Data' }).first().click()
    await page.getByLabel('Choose a backup file').setInputFiles({
      name: 'not-a-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from('this is not json'),
    })

    await expect(page.getByText('That file is not valid JSON.').first()).toBeVisible()
    await expect(page.getByText('Your database was not changed.')).toBeVisible()

    await page.getByRole('link', { name: 'Home' }).first().click()
    await expect(dayCell(page, '30 min')).toBeVisible()
  })
})

test.describe('platform behaviour', () => {
  test('every hash route survives a reload on the Pages base path', async ({ page }) => {
    await completeOnboarding(page)
    const habitUrl = page.url()
    expect(habitUrl).toContain(`${BASE_PATH}#/habit/`)

    for (const suffix of ['', '/timeline']) {
      await page.goto(`${habitUrl}${suffix}`)
      await page.reload()
      await expect(page.getByRole('button', { name: /Violin practice/ })).toBeVisible()
    }

    await page.goto(`${BASE_PATH}#/data`)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
  })

  test('loads every asset from the repository subpath', async ({ page }) => {
    const failures: string[] = []
    page.on('response', (response) => {
      if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
    })
    await completeOnboarding(page)
    await page.getByRole('link', { name: 'Data' }).first().click()
    await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
    expect(failures).toEqual([])
  })

  test('keeps working offline after the first load', async ({ page, context }, testInfo) => {
    // Playwright's WebKit build errors out reloading a page under offline
    // emulation. Offline launch is covered on real hardware instead — see the
    // iPhone acceptance checklist in docs/testing.md.
    test.skip(
      testInfo.project.name !== 'chromium',
      'Offline reload is not drivable in the WebKit test build',
    )

    await completeOnboarding(page)
    await logMinutes(page, 30)

    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker?.getRegistration()
      return Boolean(registration?.active)
    })

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('button', { name: /Violin practice/ })).toBeVisible()
    await expect(dayCell(page, '30 min')).toBeVisible()

    // Logging still works with no network at all.
    await logMinutes(page, 15)
    await expect(dayCell(page, '45 min')).toBeVisible()
    await context.setOffline(false)
  })

  test('data survives a reload', async ({ page }) => {
    await completeOnboarding(page)
    await logMinutes(page, 30)
    await page.reload()
    await expect(dayCell(page, '30 min')).toBeVisible()
  })

  test('exposes an installable manifest and icons', async ({ page, request }) => {
    await page.goto('./')
    const href = await page.getAttribute('link[rel="manifest"]', 'href')
    expect(href).toBe(`${BASE_PATH}manifest.webmanifest`)

    const manifest = await (await request.get(href as string)).json()
    expect(manifest.start_url).toBe(BASE_PATH)
    expect(manifest.scope).toBe(BASE_PATH)
    expect(manifest.display).toBe('standalone')
    expect(manifest.short_name).toBe('Habits')
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)

    for (const icon of manifest.icons) {
      const response = await request.get(`${BASE_PATH}${icon.src}`)
      expect(response.status(), `${icon.src} should be served`).toBe(200)
    }
  })

  test('ships a restrictive content security policy', async ({ page }) => {
    await page.goto('./')
    const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
    // A meta policy cannot carry frame-ancestors; claiming it would be theatre.
    expect(csp).not.toContain('frame-ancestors')
  })

  test('makes no third-party requests', async ({ page, baseURL }) => {
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await completeOnboarding(page)
    await page.getByRole('link', { name: 'Data' }).first().click()
    await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()

    const appOrigin = new URL(baseURL as string).origin
    const external = requested.filter((url) => {
      if (url.startsWith('data:') || url.startsWith('blob:')) return false
      return new URL(url).origin !== appOrigin
    })
    expect(external).toEqual([])
  })
})

test.describe('mobile layout', () => {
  test('keeps the whole log sheet above the browser chrome', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await page.getByRole('button', { name: /Log practice/i }).first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Scrolled to the end of the sheet, the primary action must sit inside the
    // visible viewport — not underneath the browser's own bottom toolbar, which
    // is what `vh` units used to put it behind.
    const save = dialog.getByRole('button', { name: 'Save entry' })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeVisible()

    const box = await save.boundingBox()
    const viewport = page.viewportSize()
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0)

    // And the sheet itself never extends past the visible viewport.
    const sheet = await dialog.boundingBox()
    expect((sheet?.y ?? 0) + (sheet?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + 1)

    // The unit label sits beside its input rather than off the edge.
    const unit = dialog.getByText('minutes', { exact: true })
    const unitBox = await unit.boundingBox()
    const sheetBox = await dialog.boundingBox()
    expect((unitBox?.x ?? 0) + (unitBox?.width ?? 0)).toBeLessThanOrEqual(
      (sheetBox?.x ?? 0) + (sheetBox?.width ?? 0),
    )
  })

  test('centres heatmap squares under their week tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await logMinutes(page, 30)

    const tab = page.getByRole('button', { name: /^Week \d+,/ }).last()
    const cell = dayCell(page, '30 min')
    const tabBox = await tab.boundingBox()
    const cellBox = await cell.boundingBox()

    const tabCentre = (tabBox?.x ?? 0) + (tabBox?.width ?? 0) / 2
    const cellCentre = (cellBox?.x ?? 0) + (cellBox?.width ?? 0) / 2
    expect(Math.abs(tabCentre - cellCentre)).toBeLessThanOrEqual(1)
  })

  test('uses the bottom bar and bottom sheets', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    const bar = page.getByRole('navigation', { name: 'Primary' }).last()
    await expect(bar).toBeVisible()

    // Every target in the bar clears the 44px minimum.
    for (const name of ['Home', 'Timeline', 'Data']) {
      const box = await bar.getByRole('link', { name }).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }

    await page.getByRole('button', { name: /Violin practice/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Choose habit' })
    await expect(sheet).toBeVisible()

    // A bottom sheet is anchored to the bottom of the viewport.
    const viewport = page.viewportSize()
    const box = await sheet.boundingBox()
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan((viewport?.height ?? 0) - 4)
  })
  test('never scrolls sideways on any screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await logMinutes(page, 30)

    /**
     * A phone screen moves in one direction: down. Anything wider than the
     * viewport makes the whole layout pan, which is what forces a reader to
     * hunt for content that was on screen a moment ago.
     */
    const expectVertical = async (where: string): Promise<void> => {
      const page_ = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(page_.scrollWidth, `${where} scrolls sideways`).toBeLessThanOrEqual(page_.clientWidth)
      expect(await sidewaysOverflow(page), `${where} has content past the edge`).toEqual([])
    }

    await expectVertical('Home')

    await page.getByRole('link', { name: 'Timeline' }).first().click()
    await expect(page.getByRole('tab', { name: 'Changes' })).toBeVisible()
    await expectVertical('Timeline')
    await page.getByRole('tab', { name: 'Changes' }).click()
    await expectVertical('Changes')

    await page.getByRole('link', { name: 'Data' }).first().click()
    await expect(page.getByRole('heading', { name: 'Data' })).toBeVisible()
    await expectVertical('Data')
  })

  test('scrolls the heatmap sideways but never vertically', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await logMinutes(page, 30)

    // Walk up from a day to whatever container actually scrolls it.
    const axes = await dayCell(page, '30 min').evaluate((cell) => {
      let node = cell.parentElement
      while (node && getComputedStyle(node).overflowX !== 'auto') node = node.parentElement
      if (!node) throw new Error('the heatmap has no horizontal scroller')
      return {
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      }
    })

    // Weeks genuinely do not fit across a phone, so this strip scrolls.
    expect(axes.scrollWidth).toBeGreaterThan(axes.clientWidth)
    // Seven weekday rows always fit, so any vertical scroll here is a bug.
    expect(axes.scrollHeight).toBeLessThanOrEqual(axes.clientHeight)
  })

  test('sizes every control so the browser never zooms in on focus', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await page.getByRole('button', { name: /Log practice/i }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // iOS Safari zooms the page when a focused control's text is under 16px,
    // and does not zoom back out — every control has to clear the threshold.
    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, select, textarea')).map((el) => ({
        id: el.id || el.getAttribute('aria-label') || el.tagName,
        size: parseFloat(getComputedStyle(el).fontSize),
      })),
    )
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter((control) => control.size < 16)).toEqual([])
  })

  test('keeps an opened help tip on screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await page.getByRole('button', { name: /Violin practice/ }).click()
    await page.getByRole('button', { name: 'Add habit' }).click()

    const tip = page.getByRole('button', { name: /What .* means/ }).first()
    await tip.scrollIntoViewIfNeeded()
    await tip.click()

    const dialog = page.getByRole('dialog')
    const panel = dialog.getByRole('note')
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    const width = page.viewportSize()?.width ?? 0
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)

    // And it did not push the sheet itself into scrolling sideways.
    const sheet = await dialog.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(sheet.scrollWidth).toBeLessThanOrEqual(sheet.clientWidth)
  })

  test('gives every target on Home at least 24px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await logMinutes(page, 30)

    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, select'))
        .filter((el) => !el.hasAttribute('disabled'))
        .map((el) => {
          const box = el.getBoundingClientRect()
          // A heatmap square is deliberately small; its target is widened into
          // the surrounding gap by a pseudo-element the box model cannot see.
          const grown = el.hasAttribute('data-heat-date') ? 4 : 0
          return {
            label: (el.textContent ?? '').trim().slice(0, 20) || el.getAttribute('aria-label'),
            width: box.width + grown,
            height: box.height + grown,
          }
        })
        .filter((el) => el.width > 0 && (el.width < 24 || el.height < 24)),
    )
    expect(small).toEqual([])
  })

  test('fits every sheet on the screen, down to the narrowest phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await completeOnboarding(page)
    await logMinutes(page, 30)

    /** Each sheet, and how to get to it from Home. */
    const sheets: { name: string; open: () => Promise<void> }[] = [
      {
        name: 'Log practice',
        open: async () => {
          await page.getByRole('button', { name: /Log practice/i }).first().click()
        },
      },
      {
        name: 'Choose habit',
        open: async () => {
          await page.getByRole('button', { name: /Violin practice/ }).click()
        },
      },
      {
        name: 'Add habit',
        open: async () => {
          await page.getByRole('button', { name: /Violin practice/ }).click()
          await page.getByRole('button', { name: 'Add habit' }).click()
        },
      },
      {
        name: 'Manage habits',
        open: async () => {
          await page.getByRole('button', { name: /Violin practice/ }).click()
          await page.getByRole('button', { name: 'Manage habits' }).click()
        },
      },
      {
        name: 'Add a goal',
        open: async () => {
          await page.getByRole('button', { name: /Add a goal/i }).first().click()
        },
      },
    ]

    // 320px is the narrowest phone still in use. Passing there leaves headroom
    // at 390 for a native control that renders wider than this engine draws it.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 700 })
      for (const sheet of sheets) {
        await sheet.open()
        await expect(page.getByRole('dialog')).toBeVisible()
        await expectSheetFits(page, `${sheet.name} at ${width}px`)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toBeHidden()
      }
    }
  })

  test('fits a negative habit\'s log sheet, where the date sits beside a time', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'Mobile-only layout')

    await page.goto('./')
    await page.getByLabel('Display name').fill('Mb')
    await page.getByRole('radio', { name: /Negative occurrence/i }).click()
    await page.getByRole('button', { name: 'Start tracking' }).click()

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 700 })
      await page.getByRole('button', { name: /Log event/i }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expectSheetFits(page, `Log event at ${width}px`)

      // The date and the time each get a line of their own, so neither depends
      // on how wide the platform decides to draw a native picker.
      const date = await dialog.locator('#entry-date').boundingBox()
      const time = await dialog.locator('#entry-time').boundingBox()
      expect(date?.y ?? 0, 'the date and time share a line').not.toEqual(time?.y ?? 0)

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
  })
})


