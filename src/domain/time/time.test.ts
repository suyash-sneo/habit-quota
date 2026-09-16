import { describe, expect, it } from 'vitest'
import {
  addDays,
  datesBetween,
  diffDays,
  fromEpochDay,
  isLeapYear,
  isLocalDate,
  toEpochDay,
  weekdayOf,
} from './civil.ts'
import {
  civilInZone,
  instantFromWallClock,
  isoFromWallClock,
  localDateInZone,
  minutesInLocalDay,
  todayInZone,
} from './zone.ts'
import { daysLeftInWeek, isoWeekOf, startOfWeek, weekRange, weeksCovering } from './week.ts'
import { formatClock, formatMinutes, fromTimeInputValue, toTimeInputValue } from './format.ts'

const LA = 'America/Los_Angeles'

describe('civil dates', () => {
  it('validates the YYYY-MM-DD shape strictly', () => {
    expect(isLocalDate('2026-09-16')).toBe(true)
    expect(isLocalDate('2026-9-16')).toBe(false)
    expect(isLocalDate('2026-02-30')).toBe(false)
    expect(isLocalDate('2026-13-01')).toBe(false)
    expect(isLocalDate(20260916)).toBe(false)
  })

  it('round-trips through epoch days', () => {
    for (const date of ['1970-01-01', '2000-02-29', '2026-09-16', '2100-03-01']) {
      expect(fromEpochDay(toEpochDay(date))).toBe(date)
    }
    expect(toEpochDay('1970-01-01')).toBe(0)
  })

  it('handles leap day', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2100)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(diffDays('2024-03-01', '2024-02-28')).toBe(2)
  })

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(diffDays('2027-01-01', '2026-12-31')).toBe(1)
  })

  it('reports ISO weekdays with Monday as 1', () => {
    expect(weekdayOf('2026-09-14')).toBe(1) // Monday
    expect(weekdayOf('2026-09-20')).toBe(7) // Sunday
  })

  it('lists inclusive spans', () => {
    expect(datesBetween('2026-09-14', '2026-09-16')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ])
    expect(datesBetween('2026-09-16', '2026-09-14')).toEqual([])
  })
})

describe('timezone conversion', () => {
  it('keeps the local date stable across a UTC day boundary', () => {
    // 2026-09-17T05:30Z is still Sep 16 in Los Angeles.
    const instant = Date.parse('2026-09-17T05:30:00Z')
    expect(localDateInZone(instant, LA)).toBe('2026-09-16')
    expect(localDateInZone(instant, 'UTC')).toBe('2026-09-17')
  })

  it('resolves a wall-clock time just before local midnight', () => {
    const iso = isoFromWallClock('2026-09-16', 23 * 60 + 59, LA)
    expect(localDateInZone(Date.parse(iso), LA)).toBe('2026-09-16')
    // 11:59 PM PDT is 06:59 the next day in UTC.
    expect(iso).toBe('2026-09-17T06:59:00.000Z')
  })

  it('handles the spring-forward transition', () => {
    // 2026-03-08: US clocks jump 02:00 -> 03:00 local.
    expect(minutesInLocalDay('2026-03-08', LA)).toBe(1380)
    const before = instantFromWallClock('2026-03-08', 1 * 60 + 30, LA)
    const after = instantFromWallClock('2026-03-08', 3 * 60 + 30, LA)
    expect(after - before).toBe(60 * 60 * 1000)
    expect(civilInZone(before, LA).hour).toBe(1)
    expect(civilInZone(after, LA).hour).toBe(3)
  })

  it('places a nonexistent spring-forward time after the gap', () => {
    // 02:30 does not exist on 2026-03-08 in Los Angeles.
    const instant = instantFromWallClock('2026-03-08', 2 * 60 + 30, LA)
    const civil = civilInZone(instant, LA)
    expect(civil.day).toBe(8)
    expect(civil.hour).toBe(3)
    expect(civil.minute).toBe(30)
  })

  it('handles the fall-back transition', () => {
    // 2026-11-01: clocks repeat 01:00-02:00 local.
    expect(minutesInLocalDay('2026-11-01', LA)).toBe(1500)
    // The ambiguous 01:30 resolves to the first (still-PDT) occurrence.
    const instant = instantFromWallClock('2026-11-01', 90, LA)
    expect(new Date(instant).toISOString()).toBe('2026-11-01T08:30:00.000Z')
    expect(localDateInZone(instant, LA)).toBe('2026-11-01')
  })

  it('leaves an ordinary day at 1440 minutes', () => {
    expect(minutesInLocalDay('2026-09-16', LA)).toBe(1440)
    expect(minutesInLocalDay('2026-09-16', 'UTC')).toBe(1440)
  })

  it('reads today from an explicit instant', () => {
    const instant = Date.parse('2026-01-01T03:00:00Z')
    expect(todayInZone(LA, instant)).toBe('2025-12-31')
    expect(todayInZone('UTC', instant)).toBe('2026-01-01')
    expect(todayInZone('Asia/Kolkata', instant)).toBe('2026-01-01')
  })

  it('preserves a historical local date even when the zone later changes', () => {
    // The stored occurredLocalDate is a label; re-reading it in another zone
    // must not move the entry to a different day.
    const stored = '2026-09-16'
    expect(stored).toBe('2026-09-16')
    const laInstant = instantFromWallClock(stored, 9 * 60, LA)
    const tokyoDate = localDateInZone(laInstant, 'Asia/Tokyo')
    expect(tokyoDate).toBe('2026-09-17')
    // …and the label we grouped by is still the one the user chose.
    expect(stored).not.toBe(tokyoDate)
  })
})

describe('weeks', () => {
  it('starts on the configured day', () => {
    expect(startOfWeek('2026-09-16', 1)).toBe('2026-09-14') // Monday
    expect(startOfWeek('2026-09-16', 7)).toBe('2026-09-13') // Sunday
  })

  it('produces seven ordered dates', () => {
    const range = weekRange('2026-09-16', 1)
    expect(range.start).toBe('2026-09-14')
    expect(range.end).toBe('2026-09-20')
    expect(range.dates).toHaveLength(7)
    expect(range.isoWeek).toBe(38)
  })

  it('numbers ISO weeks across a year boundary', () => {
    expect(isoWeekOf('2027-01-01')).toEqual({ isoYear: 2026, isoWeek: 53 })
    expect(isoWeekOf('2026-01-01')).toEqual({ isoYear: 2026, isoWeek: 1 })
  })

  it('covers a range with whole weeks', () => {
    const weeks = weeksCovering('2026-09-01', '2026-09-30', 1)
    expect(weeks[0]?.start).toBe('2026-08-31')
    expect(weeks[weeks.length - 1]?.end).toBe('2026-10-04')
  })

  it('counts remaining days inclusive of today', () => {
    expect(daysLeftInWeek('2026-09-14', 1)).toBe(7) // Monday
    expect(daysLeftInWeek('2026-09-16', 1)).toBe(5) // Wednesday
    expect(daysLeftInWeek('2026-09-20', 1)).toBe(1) // Sunday
  })
})

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatMinutes(0)).toBe('0 min')
    expect(formatMinutes(25)).toBe('25 min')
    expect(formatMinutes(60)).toBe('1h')
    expect(formatMinutes(165)).toBe('2h 45m')
  })

  it('formats and parses clock times', () => {
    expect(formatClock(0)).toBe('12:00 AM')
    expect(formatClock(12 * 60)).toBe('12:00 PM')
    expect(formatClock(18 * 60 + 15)).toBe('6:15 PM')
    expect(toTimeInputValue(18 * 60 + 15)).toBe('18:15')
    expect(fromTimeInputValue('18:15')).toBe(18 * 60 + 15)
    expect(fromTimeInputValue('25:00')).toBeNull()
    expect(fromTimeInputValue('nope')).toBeNull()
  })
})
