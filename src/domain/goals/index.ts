/**
 * Goal evaluation.
 *
 * One rule, applied everywhere: the current local day is included in remaining
 * days while it is still open. A deadline of Dec 31 evaluated on Dec 31 has one
 * day left, not zero — see docs/event-model.md.
 */

import type { DayAggregate } from '../habits/aggregate.ts'
import { aggregateSpan } from '../habits/aggregate.ts'
import type { GoalPeriod, GoalSnapshot, TrackingModel } from '../events/types.ts'
import type { IsoWeekday, LocalDate } from '../time/civil.ts'
import { addDays, daysInMonth, diffDays, parseLocalDate, toLocalDate } from '../time/civil.ts'
import { weekRange } from '../time/week.ts'

export type GoalStatus =
  | 'on-pace'
  | 'behind'
  | 'complete'
  | 'expired'
  | 'not-started'
  | 'safe'
  | 'near-limit'
  | 'reached'
  | 'exceeded'

export interface GoalProgress {
  goalId: string
  goalType: GoalSnapshot['goalType']
  status: GoalStatus
  /** Amount achieved in the window that matters for this goal type. */
  progress: number
  target: number
  /** 0–100, clamped. */
  percent: number
  /** Shortfall for minimums; overage for maximums (negative when under). */
  remaining: number
  /** Inclusive local days left in the window, counting today. */
  daysRemaining: number
  /** Only set for cumulative goals: amount per remaining day to finish. */
  requiredPerDay?: number
  windowStart: LocalDate
  windowEnd: LocalDate
}

/** Inclusive local-date window a periodic goal is evaluated over. */
export function periodWindow(
  period: GoalPeriod,
  date: LocalDate,
  weekStartsOn: IsoWeekday,
): { start: LocalDate; end: LocalDate } {
  switch (period) {
    case 'day':
      return { start: date, end: date }
    case 'week': {
      const range = weekRange(date, weekStartsOn)
      return { start: range.start, end: range.end }
    }
    case 'month': {
      const { year, month } = parseLocalDate(date)
      return {
        start: toLocalDate({ year, month, day: 1 }),
        end: toLocalDate({ year, month, day: daysInMonth(year, month) }),
      }
    }
    case 'year': {
      const { year } = parseLocalDate(date)
      return {
        start: toLocalDate({ year, month: 1, day: 1 }),
        end: toLocalDate({ year, month: 12, day: 31 }),
      }
    }
  }
}

function clampPercent(progress: number, target: number): number {
  if (target <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((progress / target) * 100)))
}

export function evaluateGoal(
  goal: GoalSnapshot,
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  today: LocalDate,
): GoalProgress {
  switch (goal.goalType) {
    case 'cumulative-by-deadline':
      return evaluateCumulative(goal, byDate, today)
    case 'periodic-minimum':
      return evaluatePeriodic(goal, byDate, today, 'minimum')
    case 'periodic-maximum':
      return evaluatePeriodic(goal, byDate, today, 'maximum')
    case 'streak':
      return evaluateStreakGoal(goal, today)
  }
}

function evaluateCumulative(
  goal: GoalSnapshot,
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  today: LocalDate,
): GoalProgress {
  const deadline = goal.deadlineLocalDate ?? today
  const windowStart = goal.effectiveFromLocalDate
  const countUntil = today < deadline ? today : deadline
  const progress = aggregateSpan(byDate, windowStart, countUntil)
  const remaining = Math.max(0, goal.targetValue - progress)
  // Today counts while it is still open, so a same-day deadline leaves one day.
  const daysRemaining = Math.max(0, diffDays(deadline, today) + 1)
  const complete = progress >= goal.targetValue
  const expired = !complete && today > deadline
  const requiredPerDay = daysRemaining > 0 ? Math.ceil(remaining / daysRemaining) : remaining

  // "On pace" means the work left per remaining day is no worse than the flat
  // rate the goal implied on the day it started.
  const totalDays = Math.max(1, diffDays(deadline, windowStart) + 1)
  const flatRate = goal.targetValue / totalDays
  const status: GoalStatus = complete
    ? 'complete'
    : expired
      ? 'expired'
      : requiredPerDay <= Math.ceil(flatRate)
        ? 'on-pace'
        : 'behind'

  return {
    goalId: goal.goalId,
    goalType: goal.goalType,
    status,
    progress,
    target: goal.targetValue,
    percent: clampPercent(progress, goal.targetValue),
    remaining,
    daysRemaining,
    requiredPerDay,
    windowStart,
    windowEnd: deadline,
  }
}

function evaluatePeriodic(
  goal: GoalSnapshot,
  byDate: ReadonlyMap<LocalDate, DayAggregate>,
  today: LocalDate,
  kind: 'minimum' | 'maximum',
): GoalProgress {
  const period = goal.period ?? 'week'
  const window = periodWindow(period, today, goal.weekStartsOn)
  const start = window.start > goal.effectiveFromLocalDate ? window.start : goal.effectiveFromLocalDate
  const progress = aggregateSpan(byDate, start, today)
  const daysRemaining = Math.max(0, diffDays(window.end, today) + 1)

  if (kind === 'minimum') {
    const remaining = Math.max(0, goal.targetValue - progress)
    const status: GoalStatus =
      progress >= goal.targetValue
        ? 'complete'
        : remaining <= 0 || daysRemaining <= 0
          ? 'expired'
          : remaining / daysRemaining <= goal.targetValue / 7
            ? 'on-pace'
            : 'behind'
    return {
      goalId: goal.goalId,
      goalType: goal.goalType,
      status,
      progress,
      target: goal.targetValue,
      percent: clampPercent(progress, goal.targetValue),
      remaining,
      daysRemaining,
      windowStart: window.start,
      windowEnd: window.end,
    }
  }

  const overage = progress - goal.targetValue
  const status: GoalStatus =
    overage > 0
      ? 'exceeded'
      : progress === goal.targetValue
        ? 'reached'
        : progress >= goal.targetValue - 1
          ? 'near-limit'
          : 'safe'

  return {
    goalId: goal.goalId,
    goalType: goal.goalType,
    status,
    progress,
    target: goal.targetValue,
    percent: clampPercent(progress, goal.targetValue),
    remaining: overage,
    daysRemaining,
    windowStart: window.start,
    windowEnd: window.end,
  }
}

function evaluateStreakGoal(goal: GoalSnapshot, today: LocalDate): GoalProgress {
  // A streak goal has no window of its own; the streak module owns the numbers.
  return {
    goalId: goal.goalId,
    goalType: goal.goalType,
    status: 'not-started',
    progress: 0,
    target: goal.targetValue,
    percent: 0,
    remaining: goal.targetValue,
    daysRemaining: 1,
    windowStart: goal.effectiveFromLocalDate,
    windowEnd: today,
  }
}

/** Goals that apply on a given local date, newest effective window first. */
export function activeGoalsOn(
  goals: readonly GoalSnapshot[],
  habitId: string,
  date: LocalDate,
): GoalSnapshot[] {
  return goals.filter(
    (g) =>
      g.habitId === habitId &&
      g.active &&
      g.effectiveFromLocalDate <= date &&
      (!g.effectiveToLocalDate || g.effectiveToLocalDate >= date),
  )
}

export function metricForModel(model: TrackingModel): GoalSnapshot['metric'] {
  switch (model) {
    case 'duration':
      return 'duration-minutes'
    case 'negative-occurrence':
      return 'occurrence-count'
    case 'completion':
    case 'count':
      return 'completion-count'
  }
}

/** The end of the period after this one — used for "Resets Monday" copy. */
export function nextPeriodStart(
  period: GoalPeriod,
  date: LocalDate,
  weekStartsOn: IsoWeekday,
): LocalDate {
  return addDays(periodWindow(period, date, weekStartsOn).end, 1)
}
