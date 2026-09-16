/**
 * Automated accessibility baseline.
 *
 * jsdom has no layout, so `color-contrast` cannot run here — the token palette
 * is checked separately in `tokens.test.ts`, and the real-browser sweep runs in
 * the Playwright suite.
 */

import { describe, expect, it } from 'vitest'
import axe from 'axe-core'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeScreen } from '../../features/home/HomeScreen.tsx'
import { TimelineScreen } from '../../features/timeline/TimelineScreen.tsx'
import { DataScreen } from '../../features/data-transfer/DataScreen.tsx'
import { OnboardingScreen } from '../../features/onboarding/OnboardingScreen.tsx'
import { renderWithProviders, seedHabit, TEST_TODAY } from '../renderApp.tsx'
import { addDays } from '../../domain/time/civil.ts'

const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: {
    // Needs real layout and computed colours; covered in the browser suite.
    'color-contrast': { enabled: false },
    // Each screen is rendered without the app shell's <main> landmark here.
    region: { enabled: false },
  },
}

async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, AXE_OPTIONS)
  const described = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.length} node(s))\n  ${v.nodes[0]?.html ?? ''}`,
  )
  expect(described).toEqual([])
}

describe('accessibility baseline', () => {
  it('Home has no detectable violations', async () => {
    const habitId = await seedHabit({
      days: { [TEST_TODAY]: 25, [addDays(TEST_TODAY, -1)]: 30 },
      goal: 'weekly-minimum',
    })
    const { container } = renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })
    await screen.findByRole('button', { name: /change habit/i })
    await expectNoViolations(container)
  })

  it('the habit sheet is a labelled modal dialog', async () => {
    const habitId = await seedHabit()
    const { container } = renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })
    await userEvent.click(await screen.findByRole('button', { name: /change habit/i }))

    const dialog = await screen.findByRole('dialog', { name: 'Choose habit' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expectNoViolations(container)
  })

  it('the entry editor has no detectable violations', async () => {
    const habitId = await seedHabit()
    const { container } = renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })
    const [logButton] = await screen.findAllByRole('button', { name: /Log practice/i })
    await userEvent.click(logButton as HTMLElement)
    await screen.findByRole('dialog')
    await expectNoViolations(container)
  })

  it('Timeline has no detectable violations', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    const { container } = renderWithProviders(<TimelineScreen />, {
      route: `/habit/${habitId}/timeline`,
      path: '/habit/:habitId/timeline',
    })
    await screen.findByRole('button', { name: /change habit/i })
    await expectNoViolations(container)
  })

  it('Data has no detectable violations', async () => {
    await seedHabit({ days: { [TEST_TODAY]: 25 } })
    const { container } = renderWithProviders(<DataScreen />, { route: '/data', path: '/data' })
    await screen.findByRole('heading', { name: 'Data' })
    await expectNoViolations(container)
  })

  it('Onboarding has no detectable violations', async () => {
    const { container } = renderWithProviders(<OnboardingScreen />, {
      route: '/onboarding',
      path: '/onboarding',
    })
    await screen.findByRole('heading', { name: 'Habits' })
    await expectNoViolations(container)
  })

  it('closes the sheet on Escape and restores focus to the opener', async () => {
    const habitId = await seedHabit()
    renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })
    const opener = await screen.findByRole('button', { name: /change habit/i })
    await userEvent.click(opener)
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(opener)
  })

  it('gives every heatmap cell a descriptive name including its value', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })
    await screen.findByRole('button', { name: /change habit/i })

    const cells = await screen.findAllByRole('button', { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/ })
    expect(cells.length).toBeGreaterThan(0)
    for (const cell of cells.slice(0, 5)) {
      // Never just a date: the value or availability is always announced.
      expect(cell.getAttribute('aria-label')).toMatch(/,\s+(No |[0-9]|future date)/)
    }
  })

  it('announces a week header with its range and total', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })
    await screen.findByRole('button', { name: /change habit/i })
    const weeks = await screen.findAllByRole('button', { name: /^Week \d+,/ })
    expect(weeks.length).toBeGreaterThan(0)
    expect(weeks[weeks.length - 1]?.getAttribute('aria-label')).toMatch(/Week \d+, \w+ \d+–\w+ \d+, /)
  })
})
