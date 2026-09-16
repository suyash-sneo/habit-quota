/**
 * Week boundaries under a configurable start day, plus the `W37`-style labels
 * the heatmap column headers use.
 */

import type { IsoWeekday, LocalDate } from './civil.ts'
import { addDays, toEpochDay, weekdayOf } from './civil.ts'

export interface WeekRange {
  /** First local date of the week, under the configured start day. */
  start: LocalDate
  /** Last local date of the week (start + 6). */
  end: LocalDate
  /** The seven local dates, in order. */
  dates: LocalDate[]
  /** ISO-8601 week number of the week containing `start`. */
  isoWeek: number
  /** ISO-8601 week-numbering year, which can differ from the calendar year. */
  isoYear: number
  /** Stable identity for keys and comparisons. */
  key: string
}

/** The first date of the week containing `date`, under `weekStartsOn`. */
export function startOfWeek(date: LocalDate, weekStartsOn: IsoWeekday): LocalDate {
  const offset = (weekdayOf(date) - weekStartsOn + 7) % 7
  return addDays(date, -offset)
}

export function endOfWeek(date: LocalDate, weekStartsOn: IsoWeekday): LocalDate {
  return addDays(startOfWeek(date, weekStartsOn), 6)
}

export function isSameWeek(a: LocalDate, b: LocalDate, weekStartsOn: IsoWeekday): boolean {
  return startOfWeek(a, weekStartsOn) === startOfWeek(b, weekStartsOn)
}

/**
 * ISO-8601 week number and week-numbering year. Always Monday-based by
 * definition, regardless of the user's chosen week start — the label is a
 * conventional name for the week, not a restatement of the boundary.
 */
export function isoWeekOf(date: LocalDate): { isoYear: number; isoWeek: number } {
  // The Thursday of a date's Monday-based week determines its ISO year.
  const thursday = addDays(date, 4 - weekdayOf(date))
  const isoYear = Number(thursday.slice(0, 4))
  const jan4 = `${String(isoYear).padStart(4, '0')}-01-04`
  const week1Monday = addDays(jan4, 1 - weekdayOf(jan4))
  const isoWeek = Math.floor((toEpochDay(thursday) - toEpochDay(week1Monday)) / 7) + 1
  return { isoYear, isoWeek }
}

export function weekRange(date: LocalDate, weekStartsOn: IsoWeekday): WeekRange {
  const start = startOfWeek(date, weekStartsOn)
  const dates: LocalDate[] = []
  for (let i = 0; i < 7; i += 1) dates.push(addDays(start, i))
  const { isoWeek, isoYear } = isoWeekOf(start)
  return {
    start,
    end: dates[6] as LocalDate,
    dates,
    isoWeek,
    isoYear,
    key: start,
  }
}

/**
 * Consecutive week ranges covering `from`…`to`, aligned to `weekStartsOn`.
 * The first range may begin before `from` and the last may end after `to`, so
 * the grid is always rectangular.
 */
export function weeksCovering(
  from: LocalDate,
  to: LocalDate,
  weekStartsOn: IsoWeekday,
): WeekRange[] {
  const first = startOfWeek(from, weekStartsOn)
  const last = startOfWeek(to, weekStartsOn)
  const out: WeekRange[] = []
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 7)) {
    out.push(weekRange(cursor, weekStartsOn))
  }
  return out
}

/** Whole local days remaining in the week containing `today`, counting today. */
export function daysLeftInWeek(today: LocalDate, weekStartsOn: IsoWeekday): number {
  return 7 - ((weekdayOf(today) - weekStartsOn + 7) % 7)
}
