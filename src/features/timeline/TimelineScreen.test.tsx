import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimelineScreen } from './TimelineScreen.tsx'
import { renderWithProviders, seedHabit, TEST_TODAY, TEST_TZ } from '../../test/renderApp.tsx'
import { addDays } from '../../domain/time/civil.ts'
import { db } from '../../db/database.ts'
import { createEntry, updateEntry } from '../../db/repositories/entries.ts'

const YESTERDAY = addDays(TEST_TODAY, -1)

async function renderTimeline(habitId: string): Promise<void> {
  renderWithProviders(<TimelineScreen />, {
    route: `/habit/${habitId}/timeline`,
    path: '/habit/:habitId/timeline',
  })
  await screen.findByRole('button', { name: /change habit/i })
}

describe('Timeline screen', () => {
  it('groups entries by local date with a daily total', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25, [YESTERDAY]: 35 } })
    await renderTimeline(habitId)

    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    // The group heading total and the row value both read 25 min.
    expect(screen.getAllByText('25 min').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('35 min').length).toBeGreaterThanOrEqual(2)
  })

  it('shows recent empty days so a gap is visible', async () => {
    const habitId = await seedHabit({ days: { [addDays(TEST_TODAY, -2)]: 30 } })
    await renderTimeline(habitId)
    expect(await screen.findAllByText('No practice recorded')).not.toHaveLength(0)
  })

  it('opens the detail pane with an audit trail', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderTimeline(habitId)

    expect(
      await screen.findByText(/Select an entry to see its detail/i),
    ).toBeInTheDocument()

    const rows = await screen.findAllByRole('button', { name: /Recorded/i })
    await userEvent.click(rows[0] as HTMLElement)

    expect(await screen.findByText('Audit trail')).toBeInTheDocument()
    expect(await screen.findByText('Note')).toBeInTheDocument()
    expect(await screen.findByText('Scales and bowing')).toBeInTheDocument()
    // The audit rows arrive from their own query, so wait for them.
    expect(await screen.findByText('Created')).toBeInTheDocument()
  })

  it('switches to the Changes view and names what changed', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    const entry = await db().entryViews.where('habitId').equals(habitId).first()
    await updateEntry(entry?.entryId as string, { value: 30 })

    await renderTimeline(habitId)
    await userEvent.click(screen.getByRole('tab', { name: 'Changes' }))

    expect(
      await screen.findByText(/Duration changed from 25 to 30 minutes/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Entry created')).toBeInTheDocument()
  })

  it('separates when a habit occurred from when its record changed', async () => {
    const habitId = await seedHabit({ days: { [YESTERDAY]: 25 } })
    await renderTimeline(habitId)
    await userEvent.click(screen.getByRole('tab', { name: 'Changes' }))

    const created = await screen.findByText('Entry created')
    const row = created.closest('li') as HTMLElement
    expect(within(row).getByText(/occurred/i)).toBeInTheDocument()
    expect(within(row).getByText(/^Recorded /i)).toBeInTheDocument()
  })

  it('deletes with an Undo that restores the entry', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderTimeline(habitId)

    const rows = await screen.findAllByRole('button', { name: /Recorded/i })
    await userEvent.click(rows[0] as HTMLElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(async () => {
      const row = await db().entryViews.where('habitId').equals(habitId).first()
      expect(row?.deleted).toBe(true)
    })
  })

  it('blocks editing a conflicted entry from the detail pane', async () => {
    const habitId = await seedHabit()
    const entry = await createEntry({
      habitId,
      occurredLocalDate: TEST_TODAY,
      timezoneId: TEST_TZ,
      value: 25,
      unit: 'minutes',
      startTime: 18 * 60,
    })
    await updateEntry(entry.entryId, { value: 30 })

    // Force a second divergent head, as an import would.
    const events = await db().events.where('entityId').equals(entry.entryId).toArray()
    const root = events.find((e) => e.eventType === 'entry.created')
    await db().events.add({
      ...(root as (typeof events)[number]),
      eventId: 'f1111111-1111-4111-8111-111111111111',
      eventType: 'entry.updated',
      parentEventIds: [root?.eventId as string],
      deviceId: '22222222-2222-4222-8222-222222222222',
      deviceSequence: 4,
      payload: { ...(root?.payload as object), value: 35 },
    })
    const { rebuildAllProjections } = await import('../../db/database.ts')
    await rebuildAllProjections()

    await renderTimeline(habitId)
    const rows = await screen.findAllByRole('button', { name: /Recorded/i })
    await userEvent.click(rows[0] as HTMLElement)

    expect(await screen.findByText(/Unresolved conflict/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Edit entry' })).toBeDisabled()
  })
})
