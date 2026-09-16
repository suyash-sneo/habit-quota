/**
 * The only bridge between instants (UTC) and civil dates in a named IANA zone.
 *
 * Built on `Intl.DateTimeFormat`, which every target browser ships with a full
 * tzdata set, so DST transitions are handled by the platform rather than by us.
 */

import type { LocalDate } from './civil.ts'
import { toLocalDate } from './civil.ts'

export type TimezoneId = string

/** Minutes after local midnight, 0…1439. */
export type MinuteOfDay = number

export interface ZonedCivil {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<TimezoneId, Intl.DateTimeFormat>()

function civilFormatter(zone: TimezoneId): Intl.DateTimeFormat {
  let fmt = formatterCache.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    })
    formatterCache.set(zone, fmt)
  }
  return fmt
}

/** The device's own zone, used as the onboarding default. */
export function deviceTimezone(): TimezoneId {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function isSupportedTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** Break an instant down into the wall-clock fields shown in `zone`. */
export function civilInZone(instantMs: number, zone: TimezoneId): ZonedCivil {
  const parts = civilFormatter(zone).formatToParts(new Date(instantMs))
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0'
  const bc = get('era').startsWith('B')
  const year = Number(get('year')) * (bc ? -1 : 1)
  return {
    year: bc ? year + 1 : year,
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
  }
}

/** The local calendar date an instant falls on, in `zone`. */
export function localDateInZone(instantMs: number, zone: TimezoneId): LocalDate {
  const c = civilInZone(instantMs, zone)
  return toLocalDate({ year: c.year, month: c.month, day: c.day })
}

/** Today's local calendar date in `zone`. */
export function todayInZone(zone: TimezoneId, now: number = Date.now()): LocalDate {
  return localDateInZone(now, zone)
}

/** Minutes after local midnight for an instant, in `zone`. */
export function minuteOfDayInZone(instantMs: number, zone: TimezoneId): MinuteOfDay {
  const c = civilInZone(instantMs, zone)
  return c.hour * 60 + c.minute
}

function asUtcMs(c: ZonedCivil): number {
  const d = new Date(Date.UTC(2000, 0, 1))
  d.setUTCFullYear(c.year, c.month - 1, c.day)
  d.setUTCHours(c.hour, c.minute, c.second, 0)
  return d.getTime()
}

/** Offset of `zone` from UTC at a given instant, in milliseconds (east positive). */
export function zoneOffsetMs(instantMs: number, zone: TimezoneId): number {
  return asUtcMs(civilInZone(instantMs, zone)) - instantMs
}

/**
 * The instant at which `zone` shows the given wall-clock time.
 *
 * Two passes converge for every ordinary time. On a DST boundary they can
 * disagree, and the two edge cases are resolved deliberately:
 *
 * - **Ambiguous** (the hour repeated each autumn): the first occurrence, while
 *   the zone is still on summer time.
 * - **Nonexistent** (the hour skipped each spring): the equivalent instant just
 *   after the gap, so "2:30 AM" on a spring-forward day stores 3:30 AM on that
 *   same local date rather than silently moving to the hour before.
 */
export function instantFromWallClock(
  date: LocalDate,
  minuteOfDay: MinuteOfDay,
  zone: TimezoneId,
): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const wall: ZonedCivil = {
    year: y,
    month: m,
    day: d,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    second: 0,
  }
  const naive = asUtcMs(wall)

  const offsetA = zoneOffsetMs(naive - zoneOffsetMs(naive, zone), zone)
  const candidate = naive - offsetA
  const offsetB = zoneOffsetMs(candidate, zone)
  if (offsetB === offsetA) return candidate

  // The two passes straddle a transition. Prefer whichever actually renders
  // back as the requested wall clock.
  const rendersAsRequested = (instant: number): boolean =>
    asUtcMs(civilInZone(instant, zone)) === naive
  if (rendersAsRequested(candidate)) return candidate
  const alternative = naive - offsetB
  if (rendersAsRequested(alternative)) return alternative

  // Neither does, so this wall clock never happens. Step forward over the gap.
  return naive - Math.min(offsetA, offsetB)
}

/** RFC 3339 UTC instant for a wall-clock time in a zone. */
export function isoFromWallClock(
  date: LocalDate,
  minuteOfDay: MinuteOfDay,
  zone: TimezoneId,
): string {
  return new Date(instantFromWallClock(date, minuteOfDay, zone)).toISOString()
}

/** The instant of local midnight opening `date` in `zone`. */
export function startOfDayInstant(date: LocalDate, zone: TimezoneId): number {
  return instantFromWallClock(date, 0, zone)
}

/**
 * Length of a local calendar day in minutes. 1440 on ordinary days; 1380 or 1500
 * on DST transition days. Used so "remaining today" never over- or under-counts.
 */
export function minutesInLocalDay(date: LocalDate, zone: TimezoneId): number {
  const start = startOfDayInstant(date, zone)
  const nextDayStart = instantFromWallClock(
    // Adding a day on the civil calendar, not on the clock.
    addOneDay(date),
    0,
    zone,
  )
  return Math.round((nextDayStart - start) / 60000)
}

function addOneDay(date: LocalDate): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const t = Date.UTC(y, m - 1, d + 1)
  const nd = new Date(t)
  return toLocalDate({
    year: nd.getUTCFullYear(),
    month: nd.getUTCMonth() + 1,
    day: nd.getUTCDate(),
  })
}
