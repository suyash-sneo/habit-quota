/**
 * Pure civil-calendar arithmetic on `YYYY-MM-DD` strings.
 *
 * Nothing here touches `Date`, a timezone, or the host clock, so it cannot be
 * perturbed by DST. A `LocalDate` is a label on the calendar, not an instant.
 */

/** A local calendar date in `YYYY-MM-DD` form. */
export type LocalDate = string

/** ISO weekday: Monday is 1, Sunday is 7. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export interface CivilDate {
  year: number
  month: number
  day: number
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false
  const parts = parseLoose(value)
  return parts !== null && toLocalDate(parts) === value
}

function parseLoose(value: string): CivilDate | null {
  const m = DATE_RE.exec(value)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return { year, month, day }
}

export function parseLocalDate(value: LocalDate): CivilDate {
  const parts = parseLoose(value)
  if (!parts) throw new RangeError(`Not a valid local date: ${JSON.stringify(value)}`)
  return parts
}

export function toLocalDate({ year, month, day }: CivilDate): LocalDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/**
 * Days since 1970-01-01 for a civil date. Howard Hinnant's `days_from_civil`,
 * which is exact for every year in range and never allocates a `Date`.
 */
export function toEpochDay(date: LocalDate): number {
  const { year, month, day } = parseLocalDate(date)
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Inverse of {@link toEpochDay}. */
export function fromEpochDay(epochDay: number): LocalDate {
  const z = epochDay + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  return toLocalDate({ year: month <= 2 ? y + 1 : y, month, day })
}

export function addDays(date: LocalDate, count: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + count)
}

/** Whole calendar days from `from` to `to`; negative when `to` precedes `from`. */
export function diffDays(to: LocalDate, from: LocalDate): number {
  return toEpochDay(to) - toEpochDay(from)
}

/** ISO weekday of a local date: Monday 1 … Sunday 7. */
export function weekdayOf(date: LocalDate): IsoWeekday {
  // 1970-01-01 was a Thursday (ISO 4).
  const shifted = (((toEpochDay(date) + 3) % 7) + 7) % 7
  return (shifted + 1) as IsoWeekday
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b
}

export function clampDate(date: LocalDate, low: LocalDate, high: LocalDate): LocalDate {
  return minDate(maxDate(date, low), high)
}

/** Inclusive list of dates from `start` to `end`. Empty when `end` precedes `start`. */
export function datesBetween(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = []
  const last = toEpochDay(end)
  for (let d = toEpochDay(start); d <= last; d += 1) out.push(fromEpochDay(d))
  return out
}

/** First day of the month containing `date`. */
export function startOfMonth(date: LocalDate): LocalDate {
  const { year, month } = parseLocalDate(date)
  return toLocalDate({ year, month, day: 1 })
}

/** Last day of the month containing `date`. */
export function endOfMonth(date: LocalDate): LocalDate {
  const { year, month } = parseLocalDate(date)
  return toLocalDate({ year, month, day: daysInMonth(year, month) })
}

/** Same day-of-month `count` months on, clamped to the target month's length. */
export function addMonths(date: LocalDate, count: number): LocalDate {
  const { year, month, day } = parseLocalDate(date)
  const zeroBased = year * 12 + (month - 1) + count
  const targetYear = Math.floor(zeroBased / 12)
  const targetMonth = zeroBased - targetYear * 12 + 1
  return toLocalDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  })
}

/** January 1st of the year containing `date`. */
export function startOfYear(date: LocalDate): LocalDate {
  return toLocalDate({ year: parseLocalDate(date).year, month: 1, day: 1 })
}

/** December 31st of the year containing `date`. */
export function endOfYear(date: LocalDate): LocalDate {
  return toLocalDate({ year: parseLocalDate(date).year, month: 12, day: 31 })
}
