import { describe, expect, it } from 'vitest'
import { aggregateByDate, aggregateDay, aggregateSpan, aggregateWeek } from './aggregate.ts'
import { projectEvents } from '../events/project.ts'
import type { EntryView } from '../events/project.ts'
import { negativeInterval, positiveStreak, streakThresholdFor } from '../streaks/index.ts'
import { bucketFor, buildHeatmap, describeValue, legendFor } from '../heatmap/index.ts'
import { evaluateGoal, periodWindow } from '../goals/index.ts'
import { entriesFromDailyMinutes, entryEvent, entrySnapshot, goalSnapshot, DEVICE_B } from '../../test/fixtures/events.ts'
import type { LocalDate } from '../time/civil.ts'
import type { TrackingModel } from '../events/types.ts'

const TODAY: LocalDate = '2026-09-16' // a Wednesday

function viewsFor(
  minutesByDate: Record<LocalDate, number>,
  model: TrackingModel = 'duration',
): EntryView[] {
  return projectEvents(entriesFromDailyMinutes(minutesByDate, model)).entries
}

describe('daily aggregation', () => {
  it('sums several duration sessions on one date', () => {
    const entries = projectEvents([
      entryEvent('entry.created', entrySnapshot({ occurredLocalDate: TODAY, value: 20 })),
      entryEvent('entry.created', entrySnapshot({ occurredLocalDate: TODAY, value: 15 })),
    ]).entries
    const day = aggregateDay(entries, TODAY, 'duration')
    expect(day.value).toBe(35)
    expect(day.entryCount).toBe(2)
    expect(day.entryIds).toHaveLength(2)
  })

  it('counts completions as one each, whatever value was recorded', () => {
    const entries = projectEvents([
      entryEvent('entry.created', entrySnapshot({ value: 45, unit: 'sessions' })),
      entryEvent('entry.created', entrySnapshot({ value: 90, unit: 'sessions' })),
    ]).entries
    expect(aggregateDay(entries, TODAY, 'completion').value).toBe(2)
  })

  it('sums counts but counts negative occurrences', () => {
    const entries = projectEvents([
      entryEvent('entry.created', entrySnapshot({ value: 2, unit: 'count' })),
    ]).entries
    expect(aggregateDay(entries, TODAY, 'count').value).toBe(2)
    expect(aggregateDay(entries, TODAY, 'negative-occurrence').value).toBe(1)
  })

  it('excludes deleted and conflicted entries but flags the conflict', () => {
    const snapshot = entrySnapshot()
    const entries = projectEvents([
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.updated', { ...snapshot, value: 30 }, { eventId: 'e2', parents: ['e1'] }),
      entryEvent('entry.updated', { ...snapshot, value: 35 }, {
        eventId: 'e3',
        parents: ['e1'],
        deviceId: DEVICE_B,
      }),
    ]).entries
    const day = aggregateDay(entries, TODAY, 'duration')
    expect(day.value).toBe(0)
    expect(day.hasConflict).toBe(true)
  })

  it('indexes every date with activity', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-15': 30, '2026-09-16': 25 }), 'duration')
    expect(byDate.get('2026-09-15')?.value).toBe(30)
    expect(byDate.get('2026-09-16')?.value).toBe(25)
    expect(byDate.get('2026-09-14')).toBeUndefined()
  })

  it('sums an inclusive span', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-14': 30, '2026-09-15': 30, '2026-09-16': 25 }),
      'duration',
    )
    expect(aggregateSpan(byDate, '2026-09-14', '2026-09-16')).toBe(85)
    expect(aggregateSpan(byDate, '2026-09-15', '2026-09-15')).toBe(30)
  })
})

describe('weekly aggregation', () => {
  it('totals a Monday-start week and averages over active days only', () => {
    const byDate = aggregateByDate(
      viewsFor({
        '2026-09-14': 30,
        '2026-09-15': 35,
        '2026-09-16': 25,
        '2026-09-11': 30, // previous week — must not be counted
      }),
      'duration',
    )
    const week = aggregateWeek(byDate, TODAY, 1, TODAY)
    expect(week.range.start).toBe('2026-09-14')
    expect(week.total).toBe(90)
    expect(week.activeDays).toBe(3)
    expect(week.averageOverActiveDays).toBe(30)
  })

  it('never counts future dates', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-19': 60 }), 'duration')
    expect(aggregateWeek(byDate, TODAY, 1, TODAY).total).toBe(0)
  })

  it('shifts with the configured week start', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-13': 60, '2026-09-16': 25 }), 'duration')
    // Sunday-start: Sep 13 is in the same week as Sep 16.
    expect(aggregateWeek(byDate, TODAY, 7, TODAY).total).toBe(85)
    // Monday-start: Sep 13 belongs to the previous week.
    expect(aggregateWeek(byDate, TODAY, 1, TODAY).total).toBe(25)
  })
})

describe('positive streaks', () => {
  const threshold = 10

  it('counts back from today when today qualifies', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-14': 30, '2026-09-15': 30, '2026-09-16': 25 }),
      'duration',
    )
    const streak = positiveStreak(byDate, TODAY, threshold)
    expect(streak.current).toBe(3)
    expect(streak.todayPending).toBe(false)
    expect(streak.startedOn).toBe('2026-09-14')
  })

  it('keeps yesterday-anchored streaks alive while today is still open', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-14': 30, '2026-09-15': 30 }),
      'duration',
    )
    const streak = positiveStreak(byDate, TODAY, threshold)
    expect(streak.current).toBe(2)
    expect(streak.todayPending).toBe(true)
    expect(streak.broken).toBe(false)
  })

  it('reports a broken streak when the last completed day failed', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-13': 30 }), 'duration')
    const streak = positiveStreak(byDate, TODAY, threshold)
    expect(streak.current).toBe(0)
    expect(streak.broken).toBe(true)
  })

  it('does not count a day below the threshold', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-15': 5, '2026-09-16': 25 }),
      'duration',
    )
    expect(positiveStreak(byDate, TODAY, threshold).current).toBe(1)
  })

  it('finds the longest run in history', () => {
    const byDate = aggregateByDate(
      viewsFor({
        '2026-09-01': 30,
        '2026-09-02': 30,
        '2026-09-03': 30,
        '2026-09-04': 30,
        '2026-09-10': 30,
        '2026-09-16': 25,
      }),
      'duration',
    )
    expect(positiveStreak(byDate, TODAY, threshold).longest).toBe(4)
  })

  it('never lets a future date participate', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-16': 25, '2026-09-17': 60, '2026-09-18': 60 }),
      'duration',
    )
    expect(positiveStreak(byDate, TODAY, threshold).longest).toBe(1)
  })

  it('qualifies a completion day on a single session', () => {
    expect(streakThresholdFor('completion', 45)).toBe(1)
    expect(streakThresholdFor('duration', 15)).toBe(15)
  })
})

describe('negative intervals', () => {
  it('reports whole days since the last occurrence', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-12': 1 }, 'negative-occurrence'),
      'negative-occurrence',
    )
    expect(negativeInterval(byDate, TODAY).daysSinceLastEvent).toBe(4)
  })

  it('reports zero on the day of an occurrence', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-16': 1 }, 'negative-occurrence'),
      'negative-occurrence',
    )
    expect(negativeInterval(byDate, TODAY).daysSinceLastEvent).toBe(0)
  })

  it('counts several events on one day as a single calendar interval', () => {
    const entries = projectEvents([
      entryEvent('entry.created', entrySnapshot({ occurredLocalDate: '2026-09-12', unit: 'events', value: 1 })),
      entryEvent('entry.created', entrySnapshot({ occurredLocalDate: '2026-09-12', unit: 'events', value: 1 })),
    ]).entries
    const byDate = aggregateByDate(entries, 'negative-occurrence')
    expect(byDate.get('2026-09-12')?.value).toBe(2)
    expect(negativeInterval(byDate, TODAY).daysSinceLastEvent).toBe(4)
  })

  it('includes the open interval in the longest gap', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-08-01': 1, '2026-08-05': 1 }, 'negative-occurrence'),
      'negative-occurrence',
    )
    const state = negativeInterval(byDate, TODAY)
    expect(state.longestInterval).toBe(42)
    expect(state.lastEventDate).toBe('2026-08-05')
  })

  it('handles a history with no occurrences at all', () => {
    const state = negativeInterval(new Map(), TODAY)
    expect(state.neverOccurred).toBe(true)
    expect(state.longestInterval).toBe(0)
  })
})

describe('heatmap', () => {
  it('buckets durations using the documented thresholds', () => {
    expect(bucketFor('duration', 0)).toBe(0)
    expect(bucketFor('duration', 14)).toBe(1)
    expect(bucketFor('duration', 15)).toBe(2)
    expect(bucketFor('duration', 29)).toBe(2)
    expect(bucketFor('duration', 44)).toBe(3)
    expect(bucketFor('duration', 59)).toBe(4)
    expect(bucketFor('duration', 60)).toBe(5)
    expect(bucketFor('duration', 600)).toBe(5)
  })

  it('never gives a negative habit a green intensity', () => {
    expect(bucketFor('negative-occurrence', 0)).toBe(0)
    expect(bucketFor('negative-occurrence', 1)).toBe('negative')
    expect(bucketFor('negative-occurrence', 5)).toBe('negative')
    expect(legendFor('negative-occurrence').map((l) => l.bucket)).toEqual([0, 'negative'])
  })

  it('builds exactly the requested number of week columns', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-16': 25 }), 'duration')
    const grid = buildHeatmap({ byDate, model: 'duration', today: TODAY, weekStartsOn: 1, weekCount: 20 })
    expect(grid.weeks).toHaveLength(20)
    expect(grid.weeks.every((w) => w.cells.length === 7)).toBe(true)
    expect(grid.lastDate).toBe('2026-09-20')
  })

  it('marks future cells unavailable and empty', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-16': 25 }), 'duration')
    const grid = buildHeatmap({ byDate, model: 'duration', today: TODAY, weekStartsOn: 1, weekCount: 2 })
    const lastWeek = grid.weeks[grid.weeks.length - 1]
    const future = lastWeek?.cells.find((c) => c.localDate === '2026-09-19')
    expect(future?.isFuture).toBe(true)
    expect(future?.aggregateValue).toBe(0)
    expect(future?.accessibleLabel).toContain('future date')
  })

  it('labels an empty positive cell as unrecorded, not a confirmed zero', () => {
    expect(describeValue('duration', 0)).toBe('No practice recorded')
    expect(describeValue('duration', 25)).toBe('25 min')
    expect(describeValue('duration', 165)).toBe('2h 45m')
    expect(describeValue('negative-occurrence', 0)).toBe('No event')
  })

  it('totals each week column', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-14': 30, '2026-09-15': 35, '2026-09-16': 25 }),
      'duration',
    )
    const grid = buildHeatmap({ byDate, model: 'duration', today: TODAY, weekStartsOn: 1, weekCount: 3 })
    const current = grid.weeks[grid.weeks.length - 1]
    expect(current?.total).toBe(90)
    expect(current?.activeDays).toBe(3)
    expect(current?.label).toBe('W38')
  })
})

describe('goals', () => {
  it('computes cumulative pace including today', () => {
    const byDate = aggregateByDate(viewsFor({ '2026-09-16': 1120 }), 'duration')
    const goal = goalSnapshot({
      goalType: 'cumulative-by-deadline',
      targetValue: 3600,
      deadlineLocalDate: '2026-12-31',
      effectiveFromLocalDate: '2026-01-01',
    })
    const progress = evaluateGoal(goal, byDate, TODAY)
    expect(progress.progress).toBe(1120)
    expect(progress.remaining).toBe(2480)
    // Sep 16 through Dec 31 inclusive.
    expect(progress.daysRemaining).toBe(107)
    expect(progress.requiredPerDay).toBe(Math.ceil(2480 / 107))
    expect(progress.percent).toBe(31)
  })

  it('treats a same-day deadline as having one day left', () => {
    const goal = goalSnapshot({
      goalType: 'cumulative-by-deadline',
      targetValue: 60,
      deadlineLocalDate: TODAY,
      effectiveFromLocalDate: TODAY,
    })
    expect(evaluateGoal(goal, new Map(), TODAY).daysRemaining).toBe(1)
  })

  it('marks a cumulative goal complete and expired correctly', () => {
    const goal = goalSnapshot({
      goalType: 'cumulative-by-deadline',
      targetValue: 100,
      deadlineLocalDate: '2026-09-15',
      effectiveFromLocalDate: '2026-09-01',
    })
    const met = aggregateByDate(viewsFor({ '2026-09-10': 120 }), 'duration')
    expect(evaluateGoal(goal, met, TODAY).status).toBe('complete')

    const missed = aggregateByDate(viewsFor({ '2026-09-10': 10 }), 'duration')
    expect(evaluateGoal(goal, missed, TODAY).status).toBe('expired')
  })

  it('evaluates a weekly minimum over the current week only', () => {
    const byDate = aggregateByDate(
      viewsFor({ '2026-09-11': 300, '2026-09-14': 120, '2026-09-16': 75 }),
      'duration',
    )
    const goal = goalSnapshot({ goalType: 'periodic-minimum', targetValue: 300, period: 'week' })
    const progress = evaluateGoal(goal, byDate, TODAY)
    expect(progress.progress).toBe(195)
    expect(progress.remaining).toBe(105)
    expect(progress.daysRemaining).toBe(5)
  })

  it('reports weekly-maximum states factually', () => {
    const goal = goalSnapshot({
      goalType: 'periodic-maximum',
      metric: 'occurrence-count',
      targetValue: 2,
      period: 'week',
    })
    const safe = aggregateByDate(
      viewsFor({ '2026-09-14': 1 }, 'negative-occurrence'),
      'negative-occurrence',
    )
    expect(evaluateGoal(goal, safe, TODAY).status).toBe('near-limit')

    const reached = aggregateByDate(
      viewsFor({ '2026-09-14': 1, '2026-09-15': 1 }, 'negative-occurrence'),
      'negative-occurrence',
    )
    expect(evaluateGoal(goal, reached, TODAY).status).toBe('reached')

    const exceeded = aggregateByDate(
      viewsFor({ '2026-09-14': 1, '2026-09-15': 1, '2026-09-16': 1 }, 'negative-occurrence'),
      'negative-occurrence',
    )
    const over = evaluateGoal(goal, exceeded, TODAY)
    expect(over.status).toBe('exceeded')
    expect(over.remaining).toBe(1)
  })

  it('computes period windows', () => {
    expect(periodWindow('week', TODAY, 1)).toEqual({ start: '2026-09-14', end: '2026-09-20' })
    expect(periodWindow('month', TODAY, 1)).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(periodWindow('year', TODAY, 1)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(periodWindow('day', TODAY, 1)).toEqual({ start: TODAY, end: TODAY })
    // February in a leap year.
    expect(periodWindow('month', '2024-02-10', 1).end).toBe('2024-02-29')
  })
})
