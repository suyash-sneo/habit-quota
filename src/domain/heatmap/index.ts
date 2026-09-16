/**
 * The contribution grid: a rectangular range of local dates aligned to the
 * configured week start, with one cell per date.
 *
 * Intensity is bucketed, never a continuous scale, so the CSS can use six fixed
 * classes rather than a unique inline colour per cell.
 */

import type { DayAggregate } from '../habits/aggregate.ts'
import type { TrackingModel } from '../events/types.ts'
import type { IsoWeekday, LocalDate } from '../time/civil.ts'
import { addDays } from '../time/civil.ts'
import { formatLongDate } from '../time/format.ts'
import type { WeekRange } from '../time/week.ts'
import { startOfWeek, weeksCovering } from '../time/week.ts'

/** 0 is empty, 1–5 rise in intensity, `negative` is a restrained crimson mark. */
export type IntensityBucket = 0 | 1 | 2 | 3 | 4 | 5 | 'negative'

export interface HeatmapCell {
  localDate: LocalDate
  isFuture: boolean
  isToday: boolean
  aggregateValue: number
  entryCount: number
  intensityBucket: IntensityBucket
  hasConflict: boolean
  accessibleLabel: string
}

export interface HeatmapWeek {
  range: WeekRange
  label: string
  cells: HeatmapCell[]
  total: number
  activeDays: number
  accessibleLabel: string
}

export interface HeatmapGrid {
  weeks: HeatmapWeek[]
  firstDate: LocalDate
  lastDate: LocalDate
}

export interface LegendStop {
  label: string
  bucket: IntensityBucket
}

/** Duration buckets from the design brief, in minutes. */
const DURATION_THRESHOLDS = [14, 29, 44, 59] as const

export function bucketFor(model: TrackingModel, value: number): IntensityBucket {
  if (model === 'negative-occurrence') return value > 0 ? 'negative' : 0
  if (value <= 0) return 0
  if (model === 'duration') {
    if (value <= DURATION_THRESHOLDS[0]) return 1
    if (value <= DURATION_THRESHOLDS[1]) return 2
    if (value <= DURATION_THRESHOLDS[2]) return 3
    if (value <= DURATION_THRESHOLDS[3]) return 4
    return 5
  }
  // Completion and count: one is a solid mid-tone, more than one is the top tone.
  return value === 1 ? 3 : 5
}

export function legendFor(model: TrackingModel): LegendStop[] {
  switch (model) {
    case 'duration':
      return [
        { label: '0', bucket: 0 },
        { label: '1–14', bucket: 1 },
        { label: '15–29', bucket: 2 },
        { label: '30–44', bucket: 3 },
        { label: '45–59', bucket: 4 },
        { label: '60+', bucket: 5 },
      ]
    case 'negative-occurrence':
      return [
        { label: 'none', bucket: 0 },
        { label: 'event', bucket: 'negative' },
      ]
    default:
      return [
        { label: '0', bucket: 0 },
        { label: '1', bucket: 3 },
        { label: '2+', bucket: 5 },
      ]
  }
}

/** Human description of a day's value; also the screen-reader text. */
export function describeValue(model: TrackingModel, value: number): string {
  switch (model) {
    case 'negative-occurrence':
      if (value <= 0) return 'No event'
      return value === 1 ? '1 event' : `${value} events`
    case 'duration':
      if (value <= 0) return 'No practice recorded'
      if (value < 60) return `${value} min`
      return value % 60 === 0
        ? `${Math.floor(value / 60)}h`
        : `${Math.floor(value / 60)}h ${value % 60}m`
    case 'completion':
    case 'count':
      if (value <= 0) return 'No session'
      return value === 1 ? '1 session' : `${value} sessions`
  }
}

export interface BuildGridOptions {
  byDate: ReadonlyMap<LocalDate, DayAggregate>
  model: TrackingModel
  today: LocalDate
  weekStartsOn: IsoWeekday
  /** How many week columns to render, newest last. */
  weekCount: number
  /** Render through the end of the week containing this date. Defaults to today. */
  through?: LocalDate
}

/**
 * Builds exactly `weekCount` columns ending with the week that contains
 * `through`. Only this range is materialised, so a decade of history never
 * creates thousands of offscreen focusable cells.
 */
export function buildHeatmap({
  byDate,
  model,
  today,
  weekStartsOn,
  weekCount,
  through,
}: BuildGridOptions): HeatmapGrid {
  const anchor = through ?? today
  const lastWeekStart = startOfWeek(anchor, weekStartsOn)
  const firstWeekStart = addDays(lastWeekStart, -(Math.max(1, weekCount) - 1) * 7)
  const ranges = weeksCovering(firstWeekStart, lastWeekStart, weekStartsOn)

  const weeks = ranges.map((range) => {
    let total = 0
    let activeDays = 0
    const cells = range.dates.map((localDate) => {
      const agg = byDate.get(localDate)
      const value = agg?.value ?? 0
      const isFuture = localDate > today
      if (!isFuture && value > 0) {
        total += value
        activeDays += 1
      }
      return {
        localDate,
        isFuture,
        isToday: localDate === today,
        aggregateValue: isFuture ? 0 : value,
        entryCount: isFuture ? 0 : (agg?.entryCount ?? 0),
        intensityBucket: isFuture ? (0 as IntensityBucket) : bucketFor(model, value),
        hasConflict: !isFuture && (agg?.hasConflict ?? false),
        accessibleLabel: `${formatLongDate(localDate)}, ${
          isFuture ? 'future date' : describeValue(model, value)
        }`,
      } satisfies HeatmapCell
    })

    return {
      range,
      label: `W${range.isoWeek}`,
      cells,
      total,
      activeDays,
      accessibleLabel: `Week ${range.isoWeek}, ${monthDay(range.start)}–${monthDay(range.end)}, ${describeValue(model, total)}`,
    } satisfies HeatmapWeek
  })

  return {
    weeks,
    firstDate: firstWeekStart,
    lastDate: addDays(lastWeekStart, 6),
  }
}

function monthDay(date: LocalDate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [, m, d] = date.split('-') as [string, string, string]
  return `${months[Number(m) - 1]} ${Number(d)}`
}
