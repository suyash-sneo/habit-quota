/**
 * Named reporting windows — this week, this month, the last 30 days, this year,
 * lifetime — and the statistics the dashboard reads off each one.
 *
 * Everything here is derived from the same `DayAggregate` map the heatmap and
 * the goals already use. Nothing is stored, so a window can be added, renamed
 * or removed without touching a single recorded event.
 *
 * Two averages are reported on purpose. `averagePerElapsedDay` divides by every
 * day in the window, which is what "hours per day" normally means; but this app
 * is deliberate that an untouched day is not a confirmed zero, so
 * `averagePerActiveDay` divides only by days that carry a record. They answer
 * different questions and the panel shows both rather than picking one.
 */

import type { DayAggregate } from './aggregate.ts'
import type { IsoWeekday, LocalDate } from '../time/civil.ts'
import {
  addDays,
  addMonths,
  datesBetween,
  diffDays,
  endOfMonth,
  maxDate,
  minDate,
  startOfMonth,
  startOfYear,
} from '../time/civil.ts'
import { startOfWeek } from '../time/week.ts'

export type PeriodKey = 'week' | 'month' | 'last30' | 'year' | 'lifetime'

export interface PeriodRange {
  key: PeriodKey
  /** Tab wording. */
  label: string
  /** Nominal first date of the window, before any clamp to recorded history. */
  nominalStart: LocalDate
  /**
   * First date actually counted: the nominal start, or the day tracking began
   * when that is later. Averaging over days before the habit existed would
   * quietly understate every window but `lifetime`.
   */
  start: LocalDate
  /** Last date counted. Never in the future. */
  end: LocalDate
  /** True when `start` had to be moved forward to the first recorded day. */
  clamped: boolean
}

export interface PeriodStats {
  /** Minutes for a duration habit; sessions or occurrences otherwise. */
  total: number
  /** Days in the window up to and including today. */
  elapsedDays: number
  /** Days in the window carrying a value above zero. */
  activeDays: number
  /** `total / elapsedDays`, unrounded. Zero when the window is empty. */
  averagePerElapsedDay: number
  /** `total / activeDays`, unrounded. Zero when nothing was logged. */
  averagePerActiveDay: number
  /** 90th percentile of the active days' values. Zero when nothing was logged. */
  p90: number
  /** Largest single-day value in the window. */
  best: number
  bestDate: LocalDate | null
  /** True when any day in the window holds an unresolved entry. */
  hasConflict: boolean
}

export const EMPTY_PERIOD_STATS: PeriodStats = {
  total: 0,
  elapsedDays: 0,
  activeDays: 0,
  averagePerElapsedDay: 0,
  averagePerActiveDay: 0,
  p90: 0,
  best: 0,
  bestDate: null,
  hasConflict: false,
}

/**
 * Linear-interpolated percentile over an ascending list — the "R-7" definition,
 * the one Excel's `PERCENTILE.INC` and NumPy's default both use. Chosen because
 * these samples are small: a nearest-rank percentile over nine practice days
 * jumps in visible steps as a single day is logged.
 */
export function percentile(ascending: readonly number[], fraction: number): number {
  if (ascending.length === 0) return 0
  if (ascending.length === 1) return ascending[0] as number
  const position = (ascending.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const low = ascending[lower] as number
  if (lower === upper) return low
  const high = ascending[upper] as number
  return low + (high - low) * (position - lower)
}

/** Earliest date carrying any recorded value, or null when nothing is logged. */
export function firstRecordedDate(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
): LocalDate | null {
  let earliest: LocalDate | null = null
  for (const [date, agg] of byDate) {
    if (agg.value <= 0 && !agg.hasConflict) continue
    if (earliest === null || date < earliest) earliest = date
  }
  return earliest
}

/**
 * The five windows, in the order the tabs show them.
 *
 * `trackingStart` is where the habit's history actually begins; windows that
 * would reach back further are clamped to it so their per-day averages divide
 * by days the habit could have been practised on.
 */
export function periodRanges(
  today: LocalDate,
  weekStartsOn: IsoWeekday,
  trackingStart: LocalDate | null,
): PeriodRange[] {
  const floor = trackingStart ?? today
  const nominal: Array<{ key: PeriodKey; label: string; nominalStart: LocalDate }> = [
    { key: 'week', label: 'This week', nominalStart: startOfWeek(today, weekStartsOn) },
    { key: 'month', label: 'This month', nominalStart: startOfMonth(today) },
    { key: 'last30', label: 'Last 30 days', nominalStart: addDays(today, -29) },
    { key: 'year', label: 'This year', nominalStart: startOfYear(today) },
    { key: 'lifetime', label: 'Lifetime', nominalStart: floor },
  ]
  return nominal.map(({ key, label, nominalStart }) => {
    const start = maxDate(nominalStart, floor)
    return {
      key,
      label,
      nominalStart,
      start: minDate(start, today),
      end: today,
      clamped: key !== 'lifetime' && start !== nominalStart,
    }
  })
}

export function periodStats(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  from: LocalDate,
  to: LocalDate,
): PeriodStats {
  if (from > to) return EMPTY_PERIOD_STATS
  const active: number[] = []
  let total = 0
  let best = 0
  let bestDate: LocalDate | null = null
  let hasConflict = false

  for (const [date, agg] of byDate) {
    if (date < from || date > to) continue
    if (agg.hasConflict) hasConflict = true
    if (agg.value <= 0) continue
    total += agg.value
    active.push(agg.value)
    if (agg.value > best) {
      best = agg.value
      bestDate = date
    }
  }

  const elapsedDays = diffDays(to, from) + 1
  active.sort((a, b) => a - b)

  return {
    total,
    elapsedDays,
    activeDays: active.length,
    averagePerElapsedDay: elapsedDays > 0 ? total / elapsedDays : 0,
    averagePerActiveDay: active.length > 0 ? total / active.length : 0,
    p90: percentile(active, 0.9),
    best,
    bestDate,
    hasConflict,
  }
}

/* ------------------------------------------------------------- the series */

export type BucketUnit = 'day' | 'week' | 'month'

export interface SeriesBucket {
  /** Stable key for React and for hit-testing. */
  key: string
  start: LocalDate
  /** Last date in the bucket, clamped to the window's end. */
  end: LocalDate
  /** Short axis wording, e.g. `Mon`, `14`, `Sep`. */
  label: string
  value: number
  /** Days in the bucket up to today — the denominator for its own average. */
  days: number
  activeDays: number
  hasConflict: boolean
  /** True when the bucket is still accruing, so its column is drawn muted. */
  isPartial: boolean
}

/**
 * Bucket width for a window, chosen so a chart never asks a phone to draw more
 * columns than it has pixels for. Roughly: up to ten weeks stays daily, up to
 * three years goes monthly, weekly in between.
 */
export function chooseBucketUnit(from: LocalDate, to: LocalDate): BucketUnit {
  const days = diffDays(to, from) + 1
  if (days <= 70) return 'day'
  if (days <= 400) return 'week'
  return 'month'
}

const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function bucketStarts(
  from: LocalDate,
  to: LocalDate,
  unit: BucketUnit,
  weekStartsOn: IsoWeekday,
): LocalDate[] {
  const out: LocalDate[] = []
  if (unit === 'day') return datesBetween(from, to)
  if (unit === 'week') {
    for (let c = startOfWeek(from, weekStartsOn); c <= to; c = addDays(c, 7)) out.push(c)
    return out
  }
  for (let c = startOfMonth(from); c <= to; c = addMonths(c, 1)) out.push(c)
  return out
}

function bucketEnd(start: LocalDate, unit: BucketUnit): LocalDate {
  if (unit === 'day') return start
  if (unit === 'week') return addDays(start, 6)
  return endOfMonth(start)
}

function bucketLabel(start: LocalDate, unit: BucketUnit): string {
  const [, month, day] = start.split('-')
  if (unit === 'month') return MONTH_INITIALS[Number(month) - 1] as string
  if (unit === 'week') return `${Number(month)}/${Number(day)}`
  return String(Number(day))
}

/**
 * One column per bucket across the window. Buckets that begin before `from`
 * (the first week or month of a window rarely starts on its boundary) are
 * counted only from `from`, so no value is attributed outside the window.
 */
export function bucketSeries(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  from: LocalDate,
  to: LocalDate,
  unit: BucketUnit,
  weekStartsOn: IsoWeekday,
): SeriesBucket[] {
  if (from > to) return []
  return bucketStarts(from, to, unit, weekStartsOn).map((rawStart) => {
    const start = maxDate(rawStart, from)
    const rawEnd = bucketEnd(rawStart, unit)
    const end = minDate(rawEnd, to)
    let value = 0
    let activeDays = 0
    let hasConflict = false
    for (const date of datesBetween(start, end)) {
      const agg = byDate.get(date)
      if (!agg) continue
      if (agg.hasConflict) hasConflict = true
      if (agg.value <= 0) continue
      value += agg.value
      activeDays += 1
    }
    return {
      key: rawStart,
      start,
      end,
      label: bucketLabel(rawStart, unit),
      value,
      days: diffDays(end, start) + 1,
      activeDays,
      hasConflict,
      isPartial: unit !== 'day' && rawEnd > to,
    }
  })
}

/* -------------------------------------------------------------- the scale */

export interface Scale {
  lo: number
  hi: number
  /** Low, middle and high, for three gridlines. */
  ticks: number[]
}

/**
 * A y-range that frames the observations rather than starting at zero.
 *
 * A line encodes change through its slope, so it does not need a zero
 * baseline the way a bar does — a bar's *length* is the quantity, and cutting
 * the axis lies about it. Framing the data instead means an hour's practice
 * and fifty minutes' are visibly different, which on a 0–60 axis they are not.
 *
 * The padding is a sixth of the spread, at least one unit, so the extremes
 * never sit on the frame. It stops at zero because negative practice is not a
 * thing, and a flat series is given room proportional to its own value.
 */
export function niceDomain(values: readonly number[]): Scale {
  if (values.length === 0) return { lo: 0, hi: 1, ticks: [0, 1] }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = max - min
  const pad = spread === 0 ? Math.max(1, Math.ceil(max * 0.1)) : Math.max(1, Math.ceil(spread / 6))
  const lo = Math.max(0, Math.floor(min - pad))
  const hi = Math.ceil(max + pad)
  const mid = Math.round((lo + hi) / 2)
  return { lo, hi, ticks: mid > lo && mid < hi ? [lo, mid, hi] : [lo, hi] }
}
