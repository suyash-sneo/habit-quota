import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataScreen } from './DataScreen.tsx'
import { renderWithProviders, seedHabit, TEST_TODAY, TEST_TZ } from '../../test/renderApp.tsx'
import { db, ensureThisDevice } from '../../db/database.ts'
import { allEvents } from '../../db/repositories/dataTransfer.ts'
import { createEntry, updateEntry } from '../../db/repositories/entries.ts'
import { buildBackup } from '../../domain/backup/build.ts'
import { canonicalize } from '../../domain/backup/format.ts'
import type { DomainEvent, EntrySnapshot } from '../../domain/events/types.ts'

const FOREIGN_DEVICE = '22222222-2222-4222-8222-222222222222'

/** A File whose `text()` works under jsdom. */
function backupFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => contents })
  return file
}

async function renderData(): Promise<void> {
  renderWithProviders(<DataScreen />, { route: '/data', path: '/data' })
  await screen.findByRole('heading', { name: 'Data' })
}

async function chooseFile(file: File): Promise<void> {
  const input = screen.getByLabelText('Choose a backup file')
  await userEvent.upload(input, file)
}

beforeEach(() => {
  // jsdom has no download machinery; the export path falls back to an anchor.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

describe('Data screen', () => {
  it('summarises this device without a habit selector', async () => {
    await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderData()

    // The card heading and the device label both read "This device".
    expect(await screen.findByRole('heading', { name: 'This device' })).toBeInTheDocument()
    expect(screen.getByText('No sequence gaps')).toBeInTheDocument()
    expect(screen.getByText(/Coverage is the earliest and latest occurrence/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change habit/i })).not.toBeInTheDocument()
  })

  it('is honest that browser storage is not a backup', async () => {
    await seedHabit()
    await renderData()
    expect(await screen.findByText(/Browser storage is not a backup/i)).toBeInTheDocument()
  })

  it('previews an export before writing anything', async () => {
    await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderData()

    await userEvent.click(screen.getByRole('button', { name: 'Export backup' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export backup' })
    expect(within(dialog).getByText(`habit-backup-${TEST_TODAY}.json`)).toBeInTheDocument()
    expect(within(dialog).getByText(/not cloud synchronization/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/readable text/i)).toBeInTheDocument()
    expect(await db().exports.count()).toBe(0)
  })

  it('records an export in backup history', async () => {
    await seedHabit({ days: { [TEST_TODAY]: 25 } })
    await renderData()

    await userEvent.click(screen.getByRole('button', { name: 'Export backup' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export backup' })
    await userEvent.click(within(dialog).getByRole('button', { name: /Download backup|Choose location/i }))

    expect(await screen.findByText('Backup saved')).toBeInTheDocument()
    await waitFor(async () => expect(await db().exports.count()).toBe(1))
  })

  it('shows a preview and refuses to merge until conflicts are resolved', async () => {
    const habitId = await seedHabit()
    const entry = await createEntry({
      habitId,
      occurredLocalDate: TEST_TODAY,
      timezoneId: TEST_TZ,
      value: 25,
      unit: 'minutes',
      startTime: 18 * 60,
    })

    const local = await allEvents()
    const root = local.find((e) => e.entityId === entry.entryId) as DomainEvent

    // This device edits it, and another device edits the same root differently.
    await updateEntry(entry.entryId, { value: 30 })

    const foreignEdit: DomainEvent = {
      ...root,
      eventId: 'f1111111-1111-4111-8111-111111111111',
      eventType: 'entry.updated',
      parentEventIds: [root.eventId],
      deviceId: FOREIGN_DEVICE,
      deviceSequence: 1,
      recordedAt: '2026-09-16T20:47:00.000Z',
      payload: { ...(root.payload as EntrySnapshot), value: 35 },
    }
    const backup = await buildBackup({
      events: [...local, foreignEdit],
      sourceDevice: { deviceId: FOREIGN_DEVICE, label: 'Another device' },
      appVersion: '1.0.0',
    })

    await renderData()
    await chooseFile(backupFile('habit-backup-2026-09-16.json', canonicalize(backup)))

    expect(await screen.findByText('Nothing will be overwritten')).toBeInTheDocument()
    expect(screen.getByText('New events')).toBeInTheDocument()

    const mergeButton = await screen.findByRole('button', { name: /Resolve 1 conflict first/i })
    expect(mergeButton).toBeDisabled()
    // Nothing has been written.
    expect(await db().events.count()).toBe(local.length + 1)
  })

  it('resolves a conflict and merges, keeping every branch in the log', async () => {
    const habitId = await seedHabit()
    const entry = await createEntry({
      habitId,
      occurredLocalDate: TEST_TODAY,
      timezoneId: TEST_TZ,
      value: 25,
      unit: 'minutes',
      startTime: 18 * 60,
    })
    const local = await allEvents()
    const root = local.find((e) => e.entityId === entry.entryId) as DomainEvent
    await updateEntry(entry.entryId, { value: 30 })

    const foreignEdit: DomainEvent = {
      ...root,
      eventId: 'f1111111-1111-4111-8111-111111111111',
      eventType: 'entry.updated',
      parentEventIds: [root.eventId],
      deviceId: FOREIGN_DEVICE,
      deviceSequence: 1,
      recordedAt: '2026-09-16T20:47:00.000Z',
      payload: { ...(root.payload as EntrySnapshot), value: 35 },
    }
    const backup = await buildBackup({
      events: [...local, foreignEdit],
      sourceDevice: { deviceId: FOREIGN_DEVICE, label: 'Another device' },
      appVersion: '1.0.0',
    })

    await renderData()
    await chooseFile(backupFile('habit-backup-2026-09-16.json', canonicalize(backup)))

    await userEvent.click(await screen.findByRole('button', { name: /Review/i }))
    const dialog = await screen.findByRole('dialog', { name: /Resolve conflict/i })
    await userEvent.click(within(dialog).getByRole('radio', { name: /Use imported/i }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resolve conflict' }))

    const merge = await screen.findByRole('button', { name: /^Merge /i })
    await userEvent.click(merge)

    expect(await screen.findByText('Merge complete')).toBeInTheDocument()
    await waitFor(async () => {
      const row = await db().entryViews.get(entry.entryId)
      expect(row?.value).toBe(35)
      expect(row?.conflicted).toBe(false)
    })

    // The local branch is still there behind the resolution.
    const after = await allEvents()
    expect(after.some((e) => (e.payload as EntrySnapshot)?.value === 30)).toBe(true)
    expect(after.some((e) => e.eventType === 'conflict.resolved')).toBe(true)
    expect(after.some((e) => e.eventType === 'system.imported')).toBe(true)
    // A pre-merge snapshot was taken.
    expect(await db().snapshots.count()).toBe(1)
  })

  it('reports an already-complete backup as adding nothing', async () => {
    await seedHabit({ days: { [TEST_TODAY]: 25 } })
    const device = await ensureThisDevice()
    const backup = await buildBackup({
      events: await allEvents(),
      sourceDevice: { deviceId: device.deviceId, label: device.label },
      appVersion: '1.0.0',
    })

    await renderData()
    await chooseFile(backupFile('same.json', canonicalize(backup)))

    expect(
      await screen.findByText(/already fully present. Merging it changes nothing/i),
    ).toBeInTheDocument()
  })

  it('rejects an unreadable file without touching the database', async () => {
    await seedHabit({ days: { [TEST_TODAY]: 25 } })
    const before = await db().events.count()

    await renderData()
    await chooseFile(backupFile('broken.json', 'this is not json'))

    expect(await screen.findByText(/not valid JSON/i)).toBeInTheDocument()
    expect(screen.getByText('Your database was not changed.')).toBeInTheDocument()
    expect(await db().events.count()).toBe(before)
  })

  it('refuses a backup from a newer app version', async () => {
    await seedHabit()
    const backup = await buildBackup({
      events: await allEvents(),
      sourceDevice: { deviceId: FOREIGN_DEVICE, label: 'Another device' },
      appVersion: '9.0.0',
    })

    await renderData()
    await chooseFile(
      backupFile('future.json', JSON.stringify({ ...backup, formatVersion: 99 })),
    )
    expect(await screen.findByText(/created by a newer app version/i)).toBeInTheDocument()
  })

  it('detects a corrupted file through its checksum', async () => {
    await seedHabit()
    const backup = await buildBackup({
      events: await allEvents(),
      sourceDevice: { deviceId: FOREIGN_DEVICE, label: 'Another device' },
      appVersion: '1.0.0',
    })

    await renderData()
    await chooseFile(
      backupFile('damaged.json', JSON.stringify({ ...backup, eventCount: 12345 })),
    )
    expect(await screen.findByText(/checksum does not match/i)).toBeInTheDocument()
  })

  it('restores the pre-merge snapshot on rollback', async () => {
    const habitId = await seedHabit()
    const local = await allEvents()

    const foreign: DomainEvent = {
      ...(local[0] as DomainEvent),
      eventId: 'f2222222-2222-4222-8222-222222222222',
      entityId: 'a3333333-3333-4333-8333-333333333333',
      entityType: 'entry',
      habitId,
      eventType: 'entry.created',
      parentEventIds: [],
      deviceId: FOREIGN_DEVICE,
      deviceSequence: 1,
      occurredLocalDate: TEST_TODAY,
      payload: {
        entryId: 'a3333333-3333-4333-8333-333333333333',
        habitId,
        occurredLocalDate: TEST_TODAY,
        timezoneId: TEST_TZ,
        value: 45,
        unit: 'minutes',
        deleted: false,
      },
    }
    const backup = await buildBackup({
      events: [...local, foreign],
      sourceDevice: { deviceId: FOREIGN_DEVICE, label: 'Another device' },
      appVersion: '1.0.0',
    })

    await renderData()
    await chooseFile(backupFile('incoming.json', canonicalize(backup)))
    await userEvent.click(await screen.findByRole('button', { name: /^Merge /i }))
    expect(await screen.findByText('Merge complete')).toBeInTheDocument()
    await waitFor(async () => expect(await db().entryViews.count()).toBe(1))

    await userEvent.click(screen.getByRole('button', { name: 'Restore snapshot' }))
    await waitFor(async () => {
      expect(await db().events.count()).toBe(local.length)
      expect(await db().entryViews.count()).toBe(0)
    })
  })
})
