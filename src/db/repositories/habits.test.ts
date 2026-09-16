import { describe, expect, it } from 'vitest'
import { defaultLogLabel } from './habits.ts'

describe('default log label', () => {
  it.each([
    ['Violin practice', 'Log practice'],
    ['MARL study', 'Log study'],
    ['Workout', 'Log workout'],
    ['Morning run', 'Log run'],
    ['Reading', 'Log reading'],
  ])('turns %s into %s', (displayName, expected) => {
    expect(defaultLogLabel({ displayName, trackingModel: 'duration', isPrivate: false })).toBe(
      expected,
    )
  })

  it('keeps an acronym capitalised', () => {
    expect(defaultLogLabel({ displayName: 'MARL', trackingModel: 'duration', isPrivate: false })).toBe(
      'Log MARL',
    )
  })

  it('never borrows words from a private habit', () => {
    expect(
      defaultLogLabel({
        displayName: 'Something personal',
        trackingModel: 'duration',
        isPrivate: true,
      }),
    ).toBe('Log event')
    expect(
      defaultLogLabel({
        displayName: 'Anything',
        trackingModel: 'negative-occurrence',
        isPrivate: false,
      }),
    ).toBe('Log event')
  })

  it('falls back when there is nothing to name', () => {
    expect(defaultLogLabel({ displayName: '   ', trackingModel: 'duration', isPrivate: false })).toBe(
      'Log entry',
    )
  })
})
