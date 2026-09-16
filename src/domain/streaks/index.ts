/**
 * Streaks for positive habits and clear-interval tracking for negative ones.
 *
 * Two rules matter and are shared by both: the current local day is *pending*
 * until it ends, and a future date never breaks anything.
 */

import type { DayAggregate } from '../habits/aggregate.ts'
import type { TrackingModel } from '../events/types.ts'
import type { LocalDate } from '../time/civil.ts'
import { addDays, diffDays } from '../time/civil.ts'

export interface StreakState {
  /** Consecutive qualifying days ending today, or ending yesterday if today is pending. */
  current: number
  longest: number
  /** True when today has not yet met the threshold but the local day is still open. */
  todayPending: boolean
  /** True when the run ended on a completed day that failed. */
  broken: boolean
  /** Local date the current run began, when there is one. */
  startedOn: LocalDate | null
}

export function qualifies(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  date: LocalDate,
  threshold: number,
): boolean {
  const agg = byDate.get(date)
  if (!agg || agg.value <= 0) return false
  return agg.value >= Math.max(1, threshold)
}

/**
 * Positive streak.
 *
 * Counting starts today when today already qualifies, and otherwise starts
 * yesterday with `todayPending` set — so a 7-day streak is never reported as
 * broken at 9am just because nothing has been logged yet.
 */
export function positiveStreak(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  today: LocalDate,
  threshold: number,
): StreakState {
  const todayQualifies = qualifies(byDate, today, threshold)
  let cursor = todayQualifies ? today : addDays(today, -1)
  let current = 0
  let startedOn: LocalDate | null = null

  while (qualifies(byDate, cursor, threshold)) {
    current += 1
    startedOn = cursor
    cursor = addDays(cursor, -1)
  }

  return {
    current,
    longest: longestPositiveRun(byDate, today, threshold),
    todayPending: !todayQualifies,
    broken: !todayQualifies && current === 0,
    startedOn,
  }
}

function longestPositiveRun(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  today: LocalDate,
  threshold: number,
): number {
  const dates = [...byDate.keys()]
    .filter((d) => d <= today && qualifies(byDate, d, threshold))
    .sort()
  let best = 0
  let run = 0
  let previous: LocalDate | null = null
  for (const date of dates) {
    run = previous && diffDays(date, previous) === 1 ? run + 1 : 1
    if (run > best) best = run
    previous = date
  }
  return best
}

export interface NegativeIntervalState {
  /** Whole local days since the most recent occurrence. 0 when one happened today. */
  daysSinceLastEvent: number
  /** Longest gap ever, including the open interval running now. */
  longestInterval: number
  lastEventDate: LocalDate | null
  /** True when there has never been an occurrence. */
  neverOccurred: boolean
}

export function negativeInterval(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  today: LocalDate,
): NegativeIntervalState {
  const dates = [...byDate.keys()]
    .filter((d) => d <= today && (byDate.get(d) as DayAggregate).value > 0)
    .sort()

  if (!dates.length) {
    return {
      daysSinceLastEvent: 0,
      longestInterval: 0,
      lastEventDate: null,
      neverOccurred: true,
    }
  }

  const last = dates[dates.length - 1] as LocalDate
  let longest = 0
  for (let i = 1; i < dates.length; i += 1) {
    const gap = diffDays(dates[i] as LocalDate, dates[i - 1] as LocalDate)
    if (gap > longest) longest = gap
  }
  const openInterval = diffDays(today, last)

  return {
    daysSinceLastEvent: openInterval,
    longestInterval: Math.max(longest, openInterval),
    lastEventDate: last,
    neverOccurred: false,
  }
}

/** Does a day count toward a streak for this model at this threshold? */
export function streakThresholdFor(model: TrackingModel, configured: number): number {
  // A completion day qualifies on a single session regardless of what was typed.
  return model === 'completion' ? 1 : Math.max(1, configured)
}
