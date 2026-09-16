/**
 * Turns a {@link GoalProgress} into the exact strings the goal card shows.
 *
 * Kept apart from the component so the wording is testable and so the "weekly
 * limit exceeded by 1" phrasing stays factual rather than moralising.
 */

import type { GoalProgress } from '../../domain/goals/index.ts'
import { nextPeriodStart } from '../../domain/goals/index.ts'
import type { GoalSnapshot, TrackingModel } from '../../domain/events/types.ts'
import type { LocalDate } from '../../domain/time/civil.ts'
import {
  formatMinutes,
  formatMonthDay,
  formatZoneName,
  pluralize,
  WEEKDAY_LONG_LABELS,
} from '../../domain/time/format.ts'
import { weekdayOf } from '../../domain/time/civil.ts'

export type GoalTone = 'good' | 'warn' | 'bad'

export interface GoalLine {
  key: string
  value: string
  label: string
  tone?: GoalTone
}

export interface GoalPresentation {
  heading: string
  subheading: string
  big: string
  bigSuffix: string
  percent: number
  percentLabel: string
  tone: GoalTone
  lines: GoalLine[]
  footnote: string
  statusLabel: string
}

function amount(model: TrackingModel, value: number): string {
  if (model === 'duration') return formatMinutes(value)
  if (model === 'negative-occurrence') return pluralize(value, 'event')
  return pluralize(value, 'session')
}

function toneFor(progress: GoalProgress): GoalTone {
  switch (progress.status) {
    case 'complete':
    case 'on-pace':
    case 'safe':
      return 'good'
    case 'behind':
    case 'near-limit':
    case 'reached':
      return 'warn'
    case 'exceeded':
    case 'expired':
      return 'bad'
    default:
      return 'good'
  }
}

export function presentGoal(
  goal: GoalSnapshot,
  progress: GoalProgress,
  model: TrackingModel,
  today: LocalDate,
): GoalPresentation {
  const tone = toneFor(progress)
  const zone = formatZoneName(goal.timezoneId)
  const weekStartName = WEEKDAY_LONG_LABELS[goal.weekStartsOn - 1] ?? 'Monday'
  const weekEndName = WEEKDAY_LONG_LABELS[(goal.weekStartsOn + 5) % 7] ?? 'Sunday'
  const calendarFootnote = `${zone} · Weeks run ${weekStartName}–${weekEndName}`

  if (goal.goalType === 'cumulative-by-deadline') {
    const deadline = goal.deadlineLocalDate ?? today
    const targetLabel =
      model === 'duration' ? `${Math.round(goal.targetValue / 60)} hours` : `${goal.targetValue}`
    return {
      heading: 'Current goal',
      subheading: `${targetLabel} by ${formatMonthDay(deadline)}`,
      big: amount(model, progress.progress),
      bigSuffix: `/ ${model === 'duration' ? `${Math.round(goal.targetValue / 60)}h` : goal.targetValue}`,
      percent: progress.percent,
      percentLabel: `${progress.percent}%`,
      tone,
      statusLabel:
        progress.status === 'complete'
          ? 'Complete'
          : progress.status === 'expired'
            ? 'Deadline passed'
            : progress.status === 'behind'
              ? 'Behind pace'
              : 'On pace',
      lines: [
        { key: 'remaining', value: amount(model, progress.remaining), label: 'remaining' },
        {
          key: 'days',
          value: pluralize(progress.daysRemaining, 'day'),
          label: `left until ${formatMonthDay(deadline)}`,
        },
        {
          key: 'pace',
          value:
            model === 'duration'
              ? `${progress.requiredPerDay ?? 0} min/day`
              : `${progress.requiredPerDay ?? 0}/day`,
          label:
            progress.status === 'complete'
              ? 'goal met'
              : progress.status === 'expired'
                ? 'deadline has passed'
                : progress.status === 'behind'
                  ? 'to finish · behind pace'
                  : 'to finish · on pace',
          tone: progress.status === 'behind' ? 'warn' : 'good',
        },
      ],
      footnote: calendarFootnote,
    }
  }

  if (goal.goalType === 'periodic-maximum') {
    const over = progress.remaining
    const resetDate = nextPeriodStart(goal.period ?? 'week', today, goal.weekStartsOn)
    const resetName = WEEKDAY_LONG_LABELS[weekdayOf(resetDate) - 1] ?? weekStartName
    return {
      heading: 'Weekly maximum',
      subheading: `No more than ${pluralize(goal.targetValue, 'event')} per ${goal.period ?? 'week'}`,
      big: String(progress.progress),
      bigSuffix: `/ ${goal.targetValue} events this ${goal.period ?? 'week'}`,
      percent: progress.percent,
      percentLabel: `${progress.percent}%`,
      tone,
      statusLabel:
        progress.status === 'exceeded'
          ? 'Limit exceeded'
          : progress.status === 'reached'
            ? 'At the limit'
            : progress.status === 'near-limit'
              ? 'Near the limit'
              : 'Within the limit',
      lines:
        over > 0
          ? [
              {
                key: 'over',
                value: `${progress.progress} / ${goal.targetValue} events`,
                label: `weekly limit exceeded by ${over}`,
                tone: 'bad',
              },
            ]
          : [
              {
                key: 'remaining',
                value: String(Math.max(0, goal.targetValue - progress.progress)),
                label: 'remaining before weekly limit',
                tone: progress.status === 'reached' ? 'warn' : undefined,
              },
            ],
      footnote: `Resets ${resetName} at 12:00 AM ${zone}`,
    }
  }

  // periodic-minimum (and the streak type, which shows the same shape)
  const period = goal.period ?? 'week'
  return {
    heading: 'Weekly minimum',
    subheading:
      model === 'duration'
        ? `${formatMinutes(goal.targetValue)} per ${period}`
        : `${pluralize(goal.targetValue, 'session')} per ${period}`,
    big: amount(model, progress.progress),
    bigSuffix: `/ ${
      model === 'duration' ? formatMinutes(goal.targetValue) : goal.targetValue
    } this ${period}`,
    percent: progress.percent,
    percentLabel: `${progress.percent}%`,
    tone,
    statusLabel:
      progress.status === 'complete'
        ? 'Met'
        : progress.status === 'expired'
          ? 'Period ended'
          : progress.status === 'behind'
            ? 'Behind pace'
            : 'On pace',
    lines: [
      { key: 'remaining', value: amount(model, progress.remaining), label: 'remaining' },
      {
        key: 'days',
        value: pluralize(progress.daysRemaining, 'day'),
        label: `left in this ${period}`,
      },
    ],
    footnote: calendarFootnote,
  }
}

export function toneColor(tone: GoalTone): string {
  switch (tone) {
    case 'good':
      return 'var(--grn)'
    case 'warn':
      return 'var(--amb)'
    case 'bad':
      return 'var(--crim)'
  }
}

export function toneInkColor(tone: GoalTone): string {
  switch (tone) {
    case 'good':
      return 'var(--grnInk)'
    case 'warn':
      return 'var(--ambInk)'
    case 'bad':
      return 'var(--crimInk)'
  }
}
