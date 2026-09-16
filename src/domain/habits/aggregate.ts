/**
 * Daily and weekly aggregation. Pure functions over projected entry rows —
 * no database, no React, no clock of their own.
 */

import type { EntryView } from '../events/project.ts'
import { countableEntries } from '../events/project.ts'
import type { TrackingModel } from '../events/types.ts'
import type { IsoWeekday, LocalDate } from '../time/civil.ts'
import { weekRange } from '../time/week.ts'
import type { WeekRange } from '../time/week.ts'

export interface DayAggregate {
  localDate: LocalDate
  /** Minutes for duration habits; a session/occurrence count otherwise. */
  value: number
  entryCount: number
  entryIds: string[]
  /** True when any entry on this date is unresolved, so the total is provisional. */
  hasConflict: boolean
}

function contribution(entry: EntryView, model: TrackingModel): number {
  switch (model) {
    case 'duration':
      return entry.value
    case 'count':
      return entry.value
    case 'completion':
    case 'negative-occurrence':
      // One entry is one session/occurrence regardless of any recorded value.
      return 1
  }
}

/** Index entries by local date once, so a heatmap does not rescan per cell. */
export function indexByDate(entries: readonly EntryView[]): Map<LocalDate, EntryView[]> {
  const byDate = new Map<LocalDate, EntryView[]>()
  for (const entry of entries) {
    const list = byDate.get(entry.occurredLocalDate)
    if (list) list.push(entry)
    else byDate.set(entry.occurredLocalDate, [entry])
  }
  return byDate
}

export function aggregateDay(
  entries: readonly EntryView[],
  localDate: LocalDate,
  model: TrackingModel,
): DayAggregate {
  const onDate = entries.filter((e) => e.occurredLocalDate === localDate)
  const counted = countableEntries(onDate)
  return {
    localDate,
    value: counted.reduce((sum, e) => sum + contribution(e, model), 0),
    entryCount: counted.length,
    entryIds: counted.map((e) => e.entryId),
    hasConflict: onDate.some((e) => e.conflicted),
  }
}

/** Day totals for every date that has at least one countable entry. */
export function aggregateByDate(
  entries: readonly EntryView[],
  model: TrackingModel,
): Map<LocalDate, DayAggregate> {
  const out = new Map<LocalDate, DayAggregate>()
  for (const entry of entries) {
    const date = entry.occurredLocalDate
    let agg = out.get(date)
    if (!agg) {
      agg = { localDate: date, value: 0, entryCount: 0, entryIds: [], hasConflict: false }
      out.set(date, agg)
    }
    if (entry.conflicted) {
      agg.hasConflict = true
      continue
    }
    if (entry.deleted) continue
    agg.value += contribution(entry, model)
    agg.entryCount += 1
    agg.entryIds.push(entry.entryId)
  }
  return out
}

export interface WeekAggregate {
  range: WeekRange
  total: number
  /** Local dates within the week that have any countable activity. */
  activeDays: number
  /** Mean over active days only — an untouched day is not a zero. */
  averageOverActiveDays: number
  hasConflict: boolean
}

export function aggregateWeek(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  anyDateInWeek: LocalDate,
  weekStartsOn: IsoWeekday,
  /** Dates after this are not yet available and never counted. */
  today: LocalDate,
): WeekAggregate {
  const range = weekRange(anyDateInWeek, weekStartsOn)
  let total = 0
  let activeDays = 0
  let hasConflict = false
  for (const date of range.dates) {
    if (date > today) continue
    const agg = byDate.get(date)
    if (!agg) continue
    if (agg.hasConflict) hasConflict = true
    if (agg.value > 0) {
      total += agg.value
      activeDays += 1
    }
  }
  return {
    range,
    total,
    activeDays,
    averageOverActiveDays: activeDays ? Math.round(total / activeDays) : 0,
    hasConflict,
  }
}

/** Sum of day values across an inclusive date span, ignoring future dates. */
export function aggregateSpan(
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  from: LocalDate,
  to: LocalDate,
): number {
  let total = 0
  for (const [date, agg] of byDate) {
    if (date >= from && date <= to) total += agg.value
  }
  return total
}
