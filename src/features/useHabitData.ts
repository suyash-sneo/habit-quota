/**
 * The one query every habit screen needs: the habit, its entries, its goals,
 * and the derived aggregates.
 *
 * Reads are scoped to the selected habit, and the derived values are memoised on
 * the row identity so scrolling the heatmap never replays the event log.
 */

import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database.ts'
import type { EntryViewRow, GoalViewRow, HabitViewRow } from '../db/schema.ts'
import { aggregateByDate } from '../domain/habits/aggregate.ts'
import type { DayAggregate } from '../domain/habits/aggregate.ts'
import { isNegativeModel } from '../domain/events/types.ts'
import type { LocalDate } from '../domain/time/civil.ts'
import { negativeInterval, positiveStreak, streakThresholdFor } from '../domain/streaks/index.ts'
import type { NegativeIntervalState, StreakState } from '../domain/streaks/index.ts'

export interface HabitData {
  loaded: boolean
  habit: HabitViewRow | null
  entries: EntryViewRow[]
  goals: GoalViewRow[]
  byDate: Map<LocalDate, DayAggregate>
  streak: StreakState
  negative: NegativeIntervalState
  isNegative: boolean
}

const EMPTY_STREAK: StreakState = {
  current: 0,
  longest: 0,
  todayPending: true,
  broken: false,
  startedOn: null,
}

const EMPTY_INTERVAL: NegativeIntervalState = {
  daysSinceLastEvent: 0,
  longestInterval: 0,
  lastEventDate: null,
  neverOccurred: true,
}

export function useHabitData(habitId: string | undefined, today: LocalDate): HabitData {
  const result = useLiveQuery(async () => {
    if (!habitId) return null
    const [habit, entries, goals] = await Promise.all([
      db().habitViews.get(habitId),
      db().entryViews.where('habitId').equals(habitId).toArray(),
      db().goalViews.where('habitId').equals(habitId).toArray(),
    ])
    if (!habit) return null
    return { habit, entries, goals }
  }, [habitId])

  return useMemo<HabitData>(() => {
    if (result === undefined) {
      return {
        loaded: false,
        habit: null,
        entries: [],
        goals: [],
        byDate: new Map(),
        streak: EMPTY_STREAK,
        negative: EMPTY_INTERVAL,
        isNegative: false,
      }
    }
    if (result === null) {
      return {
        loaded: true,
        habit: null,
        entries: [],
        goals: [],
        byDate: new Map(),
        streak: EMPTY_STREAK,
        negative: EMPTY_INTERVAL,
        isNegative: false,
      }
    }

    const { habit, entries, goals } = result
    const byDate = aggregateByDate(entries, habit.trackingModel)
    const negative = isNegativeModel(habit.trackingModel)

    return {
      loaded: true,
      habit,
      entries,
      goals: goals.sort((a, b) => Number(b.active) - Number(a.active)),
      byDate,
      streak: negative
        ? EMPTY_STREAK
        : positiveStreak(byDate, today, streakThresholdFor(habit.trackingModel, habit.streakThreshold)),
      negative: negative ? negativeInterval(byDate, today) : EMPTY_INTERVAL,
      isNegative: negative,
    }
  }, [result, today])
}

/** Every non-archived habit, for the selector and manage flows. */
export function useHabitList(includeArchived = false): HabitViewRow[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db().habitViews.orderBy('sortOrder').toArray()
    return includeArchived ? rows : rows.filter((h) => !h.archived)
  }, [includeArchived])
}
