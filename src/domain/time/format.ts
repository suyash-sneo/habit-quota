/**
 * Display formatting. Every function here is presentation only — nothing in the
 * domain branches on a formatted string.
 */

import type { LocalDate } from './civil.ts'
import { diffDays, parseLocalDate } from './civil.ts'
import type { MinuteOfDay, TimezoneId } from './zone.ts'
import { civilInZone } from './zone.ts'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const WEEKDAY_SHORT_LABELS = DOW_SHORT
export const WEEKDAY_LONG_LABELS = DOW_LONG

function weekdayIndex(date: LocalDate): number {
  // Local import avoided to keep this module free of a cycle.
  const { year, month, day } = parseLocalDate(date)
  const utc = Date.UTC(year, month - 1, day)
  return (new Date(utc).getUTCDay() + 6) % 7
}

/** `Sep 16` */
export function formatMonthDay(date: LocalDate): string {
  const { month, day } = parseLocalDate(date)
  return `${MONTHS_SHORT[month - 1]} ${day}`
}

/** `Sep 16, 2026` */
export function formatMonthDayYear(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date)
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`
}

/** `Wed` */
export function formatWeekdayShort(date: LocalDate): string {
  return DOW_SHORT[weekdayIndex(date)] as string
}

/** `Wednesday` */
export function formatWeekdayLong(date: LocalDate): string {
  return DOW_LONG[weekdayIndex(date)] as string
}

/** `Wednesday, September 16` */
export function formatLongDate(date: LocalDate): string {
  const { year, month, day } = parseLocalDate(date)
  const utc = new Date(Date.UTC(year, month - 1, day))
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utc)
}

/** `Sep 14 – Sep 20` */
export function formatDateRange(start: LocalDate, end: LocalDate): string {
  return `${formatMonthDay(start)} – ${formatMonthDay(end)}`
}

/** `Today`, `Yesterday`, or the long weekday name. */
export function formatRelativeDay(date: LocalDate, today: LocalDate): string {
  const delta = diffDays(today, date)
  if (delta === 0) return 'Today'
  if (delta === 1) return 'Yesterday'
  return formatWeekdayLong(date)
}

/** `6:15 PM` */
export function formatClock(minuteOfDay: MinuteOfDay): string {
  const total = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440
  const h24 = Math.floor(total / 60)
  const minute = total % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${suffix}`
}

/** `18:15` — the value shape an `<input type="time">` expects. */
export function toTimeInputValue(minuteOfDay: MinuteOfDay): string {
  const total = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Parses `18:15`; returns null for anything else. */
export function fromTimeInputValue(value: string): MinuteOfDay | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/** `25 min`, `1h 45m`, `2h` */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total === 0) return '0 min'
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** `1 session` / `4 sessions` */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** `Sep 16, 2026 · 10:24 PM` for an RFC 3339 instant, rendered in `zone`. */
export function formatInstant(iso: string, zone: TimezoneId): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const c = civilInZone(ms, zone)
  return `${MONTHS_SHORT[c.month - 1]} ${c.day}, ${c.year} · ${formatClock(c.hour * 60 + c.minute)}`
}

/** `10:24 PM` for an RFC 3339 instant, rendered in `zone`. */
export function formatInstantClock(iso: string, zone: TimezoneId): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const c = civilInZone(ms, zone)
  return formatClock(c.hour * 60 + c.minute)
}

/** `Pacific Time` where the platform knows a friendly name, else the raw zone id. */
export function formatZoneName(zone: TimezoneId): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'long',
    }).formatToParts(new Date())
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    if (!name) return zone
    // "Pacific Standard Time" and "Pacific Daylight Time" both read as "Pacific Time".
    return name.replace(/\b(Standard|Daylight|Summer)\s+/i, '')
  } catch {
    return zone
  }
}

export function formatCount(value: number): string {
  return value.toLocaleString()
}
