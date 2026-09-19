import { describe, expect, it } from 'vitest'
import { aggregateByDate } from './aggregate.ts'
import {
  bucketSeries,
  chooseBucketUnit,
  firstRecordedDate,
  percentile,
  periodRanges,
  periodStats,
} from './periods.ts'
import { projectEvents } from '../events/project.ts'
import { entriesFromDailyMinutes } from '../../test/fixtures/events.ts'
import type { LocalDate } from '../time/civil.ts'
import {
  addMonths,
  endOfMonth,
  endOfYear,
  startOfMonth,
  startOfYear,
} from '../time/civil.ts'

const TODAY: LocalDate = '2026-09-16' // a Wednesday

function byDateOf(minutes: Record<LocalDate, number>) {
  return aggregateByDate(projectEvents(entriesFromDailyMinutes(minutes)).entries, 'duration')
}

describe('calendar boundaries', () => {
  it('finds the edges of a month', () => {
    expect(startOfMonth('2026-09-16')).toBe('2026-09-01')
    expect(endOfMonth('2026-09-16')).toBe('2026-09-30')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
  })

  it('finds the edges of a year', () => {
    expect(startOfYear('2026-09-16')).toBe('2026-01-01')
    expect(endOfYear('2026-09-16')).toBe('2026-12-31')
  })

  it('clamps a month step to the shorter target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15')
  })
})

describe('percentile', () => {
  it('is the only value for a single sample', () => {
    expect(percentile([42], 0.9)).toBe(42)
  })

  it('is zero for an empty sample', () => {
    expect(percentile([], 0.9)).toBe(0)
  })

  it('interpolates between the two straddling ranks', () => {
    // position = (10 - 1) * 0.9 = 8.1, so a tenth of the way from 90 to 100.
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBeCloseTo(91, 10)
  })

  it('lands exactly on a rank when the position is whole', () => {
    // position = (11 - 1) * 0.9 = 9 exactly.
    expect(percentile([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9)
  })

  it('reports the max when every sample is the same', () => {
    expect(percentile([30, 30, 30, 30], 0.9)).toBe(30)
  })
})

describe('period ranges', () => {
  it('names the five windows in tab order', () => {
    const ranges = periodRanges(TODAY, 1, '2020-01-01')
    expect(ranges.map((r) => r.key)).toEqual(['week', 'month', 'last30', 'year', 'lifetime'])
  })

  it('starts each window where the calendar says', () => {
    const ranges = periodRanges(TODAY, 1, '2020-01-01')
    const start = Object.fromEntries(ranges.map((r) => [r.key, r.start]))
    expect(start.week).toBe('2026-09-14') // the Monday
    expect(start.month).toBe('2026-09-01')
    expect(start.last30).toBe('2026-08-18') // 30 days inclusive of today
    expect(start.year).toBe('2026-01-01')
    expect(start.lifetime).toBe('2020-01-01')
  })

  it('honours a Sunday week start', () => {
    const [week] = periodRanges(TODAY, 7, '2020-01-01')
    expect(week?.start).toBe('2026-09-13')
  })

  it('never reaches back before tracking began', () => {
    const ranges = periodRanges(TODAY, 1, '2026-09-10')
    const year = ranges.find((r) => r.key === 'year')
    expect(year?.nominalStart).toBe('2026-01-01')
    expect(year?.start).toBe('2026-09-10')
    expect(year?.clamped).toBe(true)
  })

  it('does not mark lifetime as clamped — it is defined by its floor', () => {
    const lifetime = periodRanges(TODAY, 1, '2026-09-10').find((r) => r.key === 'lifetime')
    expect(lifetime?.clamped).toBe(false)
  })

  it('collapses to today when nothing has ever been recorded', () => {
    for (const range of periodRanges(TODAY, 1, null)) {
      expect(range.start).toBe(TODAY)
      expect(range.end).toBe(TODAY)
    }
  })
})

describe('period statistics', () => {
  const byDate = byDateOf({
    '2026-09-14': 30,
    '2026-09-15': 90,
    '2026-09-16': 60,
  })

  it('totals only the days inside the window', () => {
    expect(periodStats(byDate, '2026-09-15', '2026-09-16').total).toBe(150)
    expect(periodStats(byDate, '2026-09-14', '2026-09-16').total).toBe(180)
  })

  it('divides the two averages by different denominators', () => {
    // Seven elapsed days, three of them active.
    const stats = periodStats(byDate, '2026-09-10', '2026-09-16')
    expect(stats.elapsedDays).toBe(7)
    expect(stats.activeDays).toBe(3)
    expect(stats.averagePerElapsedDay).toBeCloseTo(180 / 7, 10)
    expect(stats.averagePerActiveDay).toBe(60)
  })

  it('counts p90 over logged days only', () => {
    // Active values sorted: 30, 60, 90 → position (3-1)*0.9 = 1.8 → 60 + 0.8*30.
    expect(periodStats(byDate, '2026-09-10', '2026-09-16').p90).toBeCloseTo(84, 10)
  })

  it('reports the best day and its date', () => {
    const stats = periodStats(byDate, '2026-09-10', '2026-09-16')
    expect(stats.best).toBe(90)
    expect(stats.bestDate).toBe('2026-09-15')
  })

  it('is all zeros for a window with nothing in it', () => {
    const stats = periodStats(byDate, '2026-01-01', '2026-01-31')
    expect(stats.total).toBe(0)
    expect(stats.activeDays).toBe(0)
    expect(stats.averagePerElapsedDay).toBe(0)
    expect(stats.averagePerActiveDay).toBe(0)
    expect(stats.p90).toBe(0)
    expect(stats.bestDate).toBeNull()
  })

  it('is empty when the window is inverted', () => {
    expect(periodStats(byDate, '2026-09-16', '2026-09-14').elapsedDays).toBe(0)
  })

  it('counts a single day window as one elapsed day', () => {
    expect(periodStats(byDate, '2026-09-16', '2026-09-16').elapsedDays).toBe(1)
  })
})

describe('chart bucketing', () => {
  it('stays daily for short windows and widens for long ones', () => {
    expect(chooseBucketUnit('2026-09-10', '2026-09-16')).toBe('day')
    expect(chooseBucketUnit('2026-08-18', '2026-09-16')).toBe('day')
    expect(chooseBucketUnit('2026-01-01', '2026-09-16')).toBe('week')
    expect(chooseBucketUnit('2020-01-01', '2026-09-16')).toBe('month')
  })

  it('gives one column per day in a daily window', () => {
    const byDate = byDateOf({ '2026-09-14': 30, '2026-09-16': 60 })
    const series = bucketSeries(byDate, '2026-09-14', '2026-09-16', 'day', 1)
    expect(series.map((b) => b.value)).toEqual([30, 0, 60])
    expect(series.map((b) => b.label)).toEqual(['14', '15', '16'])
  })

  it('never attributes value from before the window to its first bucket', () => {
    const byDate = byDateOf({ '2026-08-31': 999, '2026-09-02': 45 })
    // September starts mid-week; the first weekly bucket must exclude Aug 31.
    const series = bucketSeries(byDate, '2026-09-01', '2026-09-16', 'week', 1)
    expect(series[0]?.start).toBe('2026-09-01')
    expect(series[0]?.value).toBe(45)
    expect(series.reduce((sum, b) => sum + b.value, 0)).toBe(45)
  })

  it('clamps the final bucket to today and marks it partial', () => {
    const byDate = byDateOf({ '2026-09-15': 60 })
    const series = bucketSeries(byDate, '2026-09-01', TODAY, 'month', 1)
    expect(series).toHaveLength(1)
    expect(series[0]?.end).toBe(TODAY)
    expect(series[0]?.isPartial).toBe(true)
    expect(series[0]?.days).toBe(16)
  })

  it('does not mark a completed bucket partial', () => {
    const byDate = byDateOf({ '2026-08-15': 60 })
    const series = bucketSeries(byDate, '2026-08-01', TODAY, 'month', 1)
    expect(series[0]?.isPartial).toBe(false)
    expect(series[1]?.isPartial).toBe(true)
  })

  it('bucket totals reconstruct the window total', () => {
    const byDate = byDateOf({
      '2026-01-05': 20,
      '2026-04-11': 35,
      '2026-07-30': 50,
      '2026-09-16': 10,
    })
    const series = bucketSeries(byDate, '2026-01-01', TODAY, 'month', 1)
    const summed = series.reduce((sum, b) => sum + b.value, 0)
    expect(summed).toBe(periodStats(byDate, '2026-01-01', TODAY).total)
    expect(series).toHaveLength(9)
  })

  it('is empty for an inverted window', () => {
    expect(bucketSeries(new Map(), '2026-09-16', '2026-09-14', 'day', 1)).toEqual([])
  })
})

describe('first recorded date', () => {
  it('is the earliest day carrying a value', () => {
    const byDate = byDateOf({ '2026-09-16': 60, '2026-03-02': 15, '2026-07-01': 20 })
    expect(firstRecordedDate(byDate)).toBe('2026-03-02')
  })

  it('is null when nothing is logged', () => {
    expect(firstRecordedDate(new Map())).toBeNull()
  })
})
