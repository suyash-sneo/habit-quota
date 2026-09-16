import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeScreen } from './HomeScreen.tsx'
import { renderWithProviders, seedHabit, TEST_TODAY } from '../../test/renderApp.tsx'
import { formatLongDate } from '../../domain/time/format.ts'
import { addDays } from '../../domain/time/civil.ts'
import { db } from '../../db/database.ts'
import { listEntriesForHabit } from '../../db/repositories/entries.ts'

const YESTERDAY = addDays(TEST_TODAY, -1)
const TWO_DAYS_AGO = addDays(TEST_TODAY, -2)

async function renderHome(habitId: string): Promise<void> {
  renderWithProviders(<HomeScreen />, {
    route: `/habit/${habitId}`,
    path: '/habit/:habitId',
  })
  await screen.findByRole('button', { name: /change habit/i })
}

describe('Home screen', () => {
  it("shows today's total, the streak, and the longest streak", async () => {
    const habitId = await seedHabit({
      days: { [TEST_TODAY]: 25, [YESTERDAY]: 30, [TWO_DAYS_AGO]: 30 },
    })
    await renderHome(habitId)

    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Current streak')).toBeInTheDocument()
    expect(screen.getByText('Longest streak')).toBeInTheDocument()

    await waitFor(() => {
      const current = screen.getByText('Current streak').previousElementSibling
      expect(current?.textContent).toContain('3')
    })
  })

  it('keeps a streak alive while today is still pending', async () => {
    const habitId = await seedHabit({ days: { [YESTERDAY]: 30, [TWO_DAYS_AGO]: 30 } })
    await renderHome(habitId)
    expect(await screen.findByText(/Today still available/i)).toBeInTheDocument()
    expect(screen.getByText(/continue your 2-day streak/i)).toBeInTheDocument()
  })

  it('says the streak is not running rather than blaming the user', async () => {
    const habitId = await seedHabit({ days: { [addDays(TEST_TODAY, -5)]: 30 } })
    await renderHome(habitId)
    expect(await screen.findByText(/No streak running/i)).toBeInTheDocument()
  })

  it('renders the habit title as the selector button', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)

    const title = screen.getByRole('button', { name: /Violin practice/i })
    expect(title).toHaveAttribute('aria-haspopup', 'dialog')
    expect(title).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(title)
    const dialog = await screen.findByRole('dialog', { name: /Choose habit/i })
    expect(within(dialog).getByText('Add habit')).toBeInTheDocument()
    expect(within(dialog).getByText('Manage habits')).toBeInTheDocument()
  })

  it('offers Add habit and Manage habits but never a Settings destination', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)
    expect(screen.queryByText(/settings/i)).not.toBeInTheDocument()
  })

  it('shows the private habit as Private with a lock, never its real name', async () => {
    const habitId = await seedHabit({
      displayName: 'Something personal',
      trackingModel: 'negative-occurrence',
      isPrivate: true,
      days: { [addDays(TEST_TODAY, -4)]: 1 },
      goal: 'weekly-maximum',
    })
    await renderHome(habitId)

    expect(await screen.findByText('Private')).toBeInTheDocument()
    expect(screen.queryByText(/Something personal/i)).not.toBeInTheDocument()
    expect(screen.getByText('Since last event')).toBeInTheDocument()
    expect(screen.getByText('Longest interval')).toBeInTheDocument()
    // No green streak language for a negative habit.
    expect(screen.queryByText(/Current streak/i)).not.toBeInTheDocument()
  })

  it('states a weekly maximum factually', async () => {
    const habitId = await seedHabit({
      displayName: 'Private',
      trackingModel: 'negative-occurrence',
      isPrivate: true,
      // Three occurrences on one local day still count three times toward the
      // weekly maximum, and this keeps the test independent of the weekday.
      days: { [TEST_TODAY]: 3 },
      goal: 'weekly-maximum',
    })
    await renderHome(habitId)
    expect(await screen.findByText('Weekly maximum')).toBeInTheDocument()
    expect(screen.getByText(/weekly limit exceeded by/i)).toBeInTheDocument()
  })

  it('renders a keyboard-navigable heatmap with labelled cells', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderHome(habitId)

    const todayCell = await screen.findByRole('button', {
      name: `${formatLongDate(TEST_TODAY)}, 25 min`,
    })
    expect(todayCell).toHaveAttribute('tabindex', '0')

    todayCell.focus()
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => {
      const focused = document.activeElement as HTMLElement
      expect(focused.dataset.heatDate).toBe(YESTERDAY)
    })
  })

  it('never allows a future cell to be selected', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderHome(habitId)
    const future = await screen.findAllByRole('button', { name: /future date/i })
    expect(future.length).toBeGreaterThan(0)
    for (const cell of future) expect(cell).toBeDisabled()
  })

  it('explains an empty cell as unrecorded, not a confirmed zero', async () => {
    const habitId = await seedHabit({ days: { [YESTERDAY]: 30 } })
    await renderHome(habitId)
    expect(
      await screen.findByText(/This is not a confirmed zero/i),
    ).toBeInTheDocument()
  })

  it('shows a week summary with totals and averages', async () => {
    const habitId = await seedHabit({
      days: { [TEST_TODAY]: 25, [YESTERDAY]: 35 },
    })
    await renderHome(habitId)
    const summary = await screen.findByLabelText('Week summary')
    expect(within(summary).getByText(/total practice time|sessions/i)).toBeInTheDocument()
  })

  it('logs an entry from Home and reflects it immediately', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)

    const [logButton] = screen.getAllByRole('button', { name: /Log practice/i })
    await userEvent.click(logButton as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '30 min' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }))

    await waitFor(async () => {
      expect(await db().entryViews.count()).toBe(1)
    })
    // Today's headline figure updates as soon as the transaction commits.
    await waitFor(() => {
      expect(screen.getByText('Today').previousElementSibling?.textContent).toContain('30')
    })
  })

  it('records no time at all unless one is entered', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)

    const [logButton] = screen.getAllByRole('button', { name: /Log practice/i })
    await userEvent.click(logButton as HTMLElement)
    const dialog = await screen.findByRole('dialog')

    // The form offers times rather than presenting them prefilled.
    expect(within(dialog).queryByLabelText('Start')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The stored event carries a date and a value, and no invented clock time.
    const rows = await listEntriesForHabit(habitId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.value).toBe(25)
    expect(rows[0]?.startTime).toBeUndefined()
    expect(rows[0]?.endTime).toBeUndefined()
    expect(rows[0]?.occurredAt).toBeUndefined()
  })

  it('refuses to save when start and end disagree with the duration', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)

    const [logButton] = screen.getAllByRole('button', { name: /Log practice/i })
    await userEvent.click(logButton as HTMLElement)
    const dialog = await screen.findByRole('dialog')

    // Times are opt-in, so there is nothing to disagree with until they exist.
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Add start and end times/i }),
    )
    const minutes = within(dialog).getByLabelText('minutes')
    await userEvent.clear(minutes)
    await userEvent.type(minutes, '90')

    expect(await within(dialog).findByText(/Resolve before saving/i)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use times' }))
    await waitFor(() => {
      expect(within(dialog).queryByText(/Resolve before saving/i)).not.toBeInTheDocument()
    })
  })

  it('shows goal progress for the selected habit only', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 60 }, goal: 'weekly-minimum' })
    await seedHabit({ displayName: 'MARL study', goal: 'cumulative' })
    await renderHome(habitId)

    expect(await screen.findByText('Weekly minimum')).toBeInTheDocument()
    expect(screen.queryByText('Current goal')).not.toBeInTheDocument()
  })

  it('offers to add a goal when there is none', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)
    expect(await screen.findByText('No goal set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeInTheDocument()
  })

  it('shows the timezone and week definition in context', async () => {
    const habitId = await seedHabit()
    await renderHome(habitId)
    expect(await screen.findByText(/Week runs Mon–Sun/i)).toBeInTheDocument()
  })
})
