import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { OnboardingScreen } from './OnboardingScreen.tsx'
import { HomeScreen } from '../home/HomeScreen.tsx'
import { renderWithProviders, seedHabit, TEST_TODAY } from '../../test/renderApp.tsx'
import { db, getSettings } from '../../db/database.ts'

describe('Onboarding', () => {
  it('explains that data stays on the device', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })
    expect(await screen.findByText(/stays in this browser/i)).toBeInTheDocument()
    expect(screen.getByText(/no account and no server/i)).toBeInTheDocument()
  })

  it('confirms timezone and week start before anything is recorded', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })
    expect(await screen.findByLabelText('Timezone')).toBeInTheDocument()
    expect(screen.getByLabelText('Week starts on')).toBeInTheDocument()
    expect(await db().habitViews.count()).toBe(0)
  })

  it('creates the first habit with the chosen calendar rules', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })

    await userEvent.type(await screen.findByLabelText('Display name'), 'Violin practice')
    await userEvent.selectOptions(screen.getByLabelText('Week starts on'), '7')
    await userEvent.click(screen.getByRole('button', { name: 'Start tracking' }))

    await waitFor(async () => expect(await db().habitViews.count()).toBe(1))
    const habit = await db().habitViews.toCollection().first()
    expect(habit?.displayName).toBe('Violin practice')
    expect(habit?.trackingModel).toBe('duration')
    expect((await getSettings()).weekStartsOn).toBe(7)
  })

  it('refuses to continue without a name unless the habit is masked', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })
    await userEvent.click(await screen.findByRole('button', { name: 'Start tracking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Give your first habit a name/i)
    expect(await db().habitViews.count()).toBe(0)
  })

  it('never stores the real name of a masked habit', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })

    await userEvent.type(await screen.findByLabelText('Display name'), 'Something personal')
    await userEvent.click(screen.getByRole('checkbox', { name: /Mask the name as/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Start tracking' }))

    await waitFor(async () => expect(await db().habitViews.count()).toBe(1))
    const habit = await db().habitViews.toCollection().first()
    expect(habit?.displayName).toBe('Private')
    expect(JSON.stringify(await db().events.toArray())).not.toContain('Something personal')
  })

  it('rejects an unrecognised timezone rather than guessing', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })

    await userEvent.type(await screen.findByLabelText('Display name'), 'Reading')
    const zone = screen.getByLabelText('Timezone')
    await userEvent.clear(zone)
    await userEvent.type(zone, 'Mars/Olympus')
    await userEvent.click(screen.getByRole('button', { name: 'Start tracking' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a timezone this browser/i)
    expect(await db().habitViews.count()).toBe(0)
  })

  it('offers importing a backup instead of starting from scratch', async () => {
    renderWithProviders(<OnboardingScreen />, { route: '/onboarding', path: '/onboarding' })
    expect(
      await screen.findByRole('button', { name: 'Import a backup instead' }),
    ).toBeInTheDocument()
  })
})

describe('Add habit from the title dropdown', () => {
  it('previews the new habit and creates it without a Settings screen', async () => {
    const habitId = await seedHabit({ days: { [TEST_TODAY]: 25 } })
    renderWithProviders(<HomeScreen />, {
      route: `/habit/${habitId}`,
      path: '/habit/:habitId',
    })

    await userEvent.click(await screen.findByRole('button', { name: /change habit/i }))
    await userEvent.click(await screen.findByText('Add habit'))

    const dialog = await screen.findByRole('dialog', { name: 'Add habit' })
    await userEvent.type(within(dialog).getByLabelText('Display name'), 'Reading')
    expect(within(dialog).getByText('Reading')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('radio', { name: /Count/ }))
    expect(within(dialog).getByText(/Cells shade by sessions/i)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create habit' }))
    await waitFor(async () => expect(await db().habitViews.count()).toBe(2))

    // displayName is deliberately not indexed, so filter in memory.
    const created = (await db().habitViews.toArray()).find((h) => h.displayName === 'Reading')
    expect(created?.trackingModel).toBe('count')
    expect(created?.sortOrder).toBe(1)
  })

  it('reorders and archives habits without deleting events', async () => {
    const first = await seedHabit({ displayName: 'Alpha' })
    await seedHabit({ displayName: 'Beta' })

    renderWithProviders(<HomeScreen />, {
      route: `/habit/${first}`,
      path: '/habit/:habitId',
    })

    await userEvent.click(await screen.findByRole('button', { name: /change habit/i }))
    await userEvent.click(await screen.findByText('Manage habits'))

    const dialog = await screen.findByRole('dialog', { name: 'Manage habits' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move Beta up' }))
    await waitFor(async () => {
      const beta = (await db().habitViews.toArray()).find((h) => h.displayName === 'Beta')
      expect(beta?.sortOrder).toBe(0)
    })

    const eventsBefore = await db().events.count()
    await userEvent.click(within(dialog).getAllByRole('button', { name: 'Archive' })[0] as HTMLElement)
    await waitFor(async () => {
      const archived = await db().habitViews.filter((h) => h.archived).count()
      expect(archived).toBe(1)
    })
    expect(await db().events.count()).toBeGreaterThan(eventsBefore)
    expect(within(dialog).getByText(/Archived habits keep all of their events/i)).toBeInTheDocument()
  })
})
