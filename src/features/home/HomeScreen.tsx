/**
 * Home: one habit, answered at a glance.
 *
 * Today, the streak, the heatmap, the selected day, the selected week, and
 * every active goal — with no cards for any other habit.
 */

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../../app/providers.tsx'
import { useIsNarrow } from '../../app/useMediaQuery.ts'
import { useHabitData, useHabitList } from '../useHabitData.ts'
import { HabitSelector } from '../habit-selector/HabitSelector.tsx'
import { Heatmap } from '../heatmap/Heatmap.tsx'
import { EntryEditor } from '../entry-editor/EntryEditor.tsx'
import { GoalPanel } from '../goals/GoalPanel.tsx'
import { GoalEditor } from '../goals/GoalEditor.tsx'
import { ScreenFallback } from '../../components/ScreenFallback.tsx'
import type { EntryViewRow } from '../../db/schema.ts'
import { aggregateWeek } from '../../domain/habits/aggregate.ts'
import { activeGoalsOn, evaluateGoal } from '../../domain/goals/index.ts'
import { describeValue, unitLabelFor } from './labels.ts'
import type { LocalDate } from '../../domain/time/civil.ts'
import { addDays } from '../../domain/time/civil.ts'
import {
  formatClock,
  formatLongDate,
  formatMinutes,
  formatMonthDay,
  formatWeekdayShort,
  formatZoneName,
  pluralize,
  WEEKDAY_SHORT_LABELS,
} from '../../domain/time/format.ts'
import { startOfWeek, weekRange } from '../../domain/time/week.ts'
import styles from './HomeScreen.module.css'

const MOBILE_WEEKS = 12
const DESKTOP_WEEKS = 20

/** `today` tracks the clock; an explicit pick pins a date; `cleared` hides the panel. */
type DaySelection = { kind: 'today' } | { kind: 'date'; date: LocalDate } | { kind: 'cleared' }

export function HomeScreen(): React.JSX.Element {
  const { habitId } = useParams<{ habitId: string }>()
  const { settings, today } = useApp()
  const habits = useHabitList()
  const data = useHabitData(habitId, today)

  // Selection follows "today" until the user picks something, so the screen is
  // correct even though `today` only settles once the stored timezone loads.
  const [daySelection, setDaySelection] = useState<DaySelection>({ kind: 'today' })
  const [weekSelection, setWeekSelection] = useState<LocalDate | null>(null)
  const [logging, setLogging] = useState<{ date: LocalDate } | null>(null)
  const [editing, setEditing] = useState<EntryViewRow | null>(null)
  const [goalEditor, setGoalEditor] = useState<{ goalId: string | null } | null>(null)

  const weekCount = useIsNarrow() ? MOBILE_WEEKS : DESKTOP_WEEKS

  const selectedDate =
    daySelection.kind === 'today' ? today : daySelection.kind === 'date' ? daySelection.date : null
  const currentWeekStart = startOfWeek(today, settings.weekStartsOn)
  const selectedWeekStart = weekSelection ?? currentWeekStart

  const selectDate = (date: LocalDate): void => {
    setDaySelection({ kind: 'date', date })
    setWeekSelection(startOfWeek(date, settings.weekStartsOn))
  }

  if (!data.loaded || habits === undefined) return <ScreenFallback label="Loading this habit…" />
  const habit = data.habit
  if (!habit) return <ScreenFallback label="That habit is no longer here." />

  const { byDate, entries, goals, streak, negative, isNegative } = data
  const model = habit.trackingModel
  const todayValue = byDate.get(today)?.value ?? 0
  const week = aggregateWeek(byDate, selectedWeekStart, settings.weekStartsOn, today)
  const selectedSessions = selectedDate
    ? entries
        .filter((e) => e.occurredLocalDate === selectedDate && !e.deleted)
        .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
    : []

  const isEmpty = entries.filter((e) => !e.deleted).length === 0

  const weekStartName = WEEKDAY_SHORT_LABELS[settings.weekStartsOn - 1] ?? 'Mon'
  const weekEndName = WEEKDAY_SHORT_LABELS[(settings.weekStartsOn + 5) % 7] ?? 'Sun'

  const streakNote = (() => {
    if (isNegative || !streak.todayPending) return null
    if (streak.current > 0) {
      return `Today still available — ${habit.logLabel.toLowerCase()} to continue your ${streak.current}-day streak`
    }
    return 'No streak running. Today is still available.'
  })()

  const weekGoalNote = (() => {
    const periodic = activeGoalsOn(goals, habit.habitId, today).find(
      (g) => g.goalType === 'periodic-minimum' || g.goalType === 'periodic-maximum',
    )
    if (!periodic || week.range.start !== currentWeekStart) return null
    const progress = evaluateGoal(periodic, byDate, today)
    if (periodic.goalType === 'periodic-maximum') {
      const over = progress.progress - progress.target
      return `Weekly maximum: ${progress.progress} of ${progress.target}${
        over > 0 ? ` · limit exceeded by ${over}` : ''
      }`
    }
    return `Weekly goal: ${describeValue(model, progress.progress)} of ${describeValue(model, progress.target)}`
  })()

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <HabitSelector habit={habit} habits={habits} />
          <div className={`${styles.date} num`}>{formatLongDate(today)}</div>
        </div>
        <div className={styles.grow} />
        <button
          type="button"
          className="btnPrimary"
          onClick={() => setLogging({ date: today })}
        >
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>
            +
          </span>
          {habit.logLabel}
        </button>
      </div>

      <div className={styles.metrics}>
        <div className={styles.metricLead}>
          <div className={styles.bigValue}>
            {isNegative ? (
              <>
                {negative.neverOccurred ? '—' : negative.daysSinceLastEvent}
                <span className={styles.bigSuffix}>
                  {negative.neverOccurred
                    ? 'no events yet'
                    : negative.daysSinceLastEvent === 1
                      ? 'day'
                      : 'days'}
                </span>
              </>
            ) : model === 'duration' ? (
              <>
                {todayValue}
                <span className={styles.bigSuffix}>min</span>
              </>
            ) : (
              <>
                {todayValue > 0 ? 'Completed' : 'Not yet'}
                {todayValue > 1 ? (
                  <span className={styles.bigSuffix}>· {pluralize(todayValue, 'session')}</span>
                ) : null}
              </>
            )}
          </div>
          <div className={styles.eyebrowLabel}>{isNegative ? 'Since last event' : 'Today'}</div>
        </div>

        <div className={styles.metricDivider} aria-hidden="true" />

        <div className={styles.metric}>
          <div className={styles.metricValue}>
            {isNegative ? week.total : streak.current}
            <span className={styles.metricSuffix}>
              {isNegative ? 'this week' : streak.current === 1 ? 'day' : 'days'}
            </span>
          </div>
          <div className={styles.metricLabel}>
            {isNegative ? 'Events logged' : 'Current streak'}
          </div>
        </div>

        <div className={styles.metricDivider} aria-hidden="true" />

        <div className={styles.metric}>
          <div className={styles.metricValue}>
            {isNegative ? negative.longestInterval : streak.longest}
            <span className={styles.metricSuffix}>days</span>
          </div>
          <div className={styles.metricLabel}>
            {isNegative ? 'Longest interval' : 'Longest streak'}
          </div>
        </div>
      </div>

      {streakNote ? (
        <p className={styles.note}>
          <span className={styles.noteDot} aria-hidden="true" />
          {streakNote}
        </p>
      ) : null}

      <div className={styles.columns}>
        <div className="card">
          <Heatmap
            byDate={byDate}
            model={model}
            today={today}
            weekStartsOn={settings.weekStartsOn}
            weekCount={weekCount}
            selectedDate={selectedDate}
            selectedWeekStart={selectedWeekStart}
            onSelectDate={selectDate}
            onSelectWeek={setWeekSelection}
            title={
              isNegative
                ? 'Event history'
                : model === 'duration'
                  ? 'Practice history'
                  : 'Session history'
            }
            unitLabel={unitLabelFor(habit.unit)}
          />

          {selectedDate ? (
            <section className={styles.dayDetail} aria-label="Day detail">
              <div className={styles.detailHead}>
                <span className="eyebrow">Day detail</span>
                <div className={styles.grow} />
                <button
                  type="button"
                  className="btnQuiet"
                  onClick={() => setDaySelection({ kind: 'cleared' })}
                >
                  Clear
                </button>
              </div>
              <div className={styles.detailTitles}>
                <span className={styles.detailTitle}>
                  {formatWeekdayShort(selectedDate)}, {formatMonthDay(selectedDate)}
                </span>
                <span
                  className={styles.detailTitle}
                  style={{
                    color:
                      (byDate.get(selectedDate)?.value ?? 0) > 0
                        ? isNegative
                          ? 'var(--crimInk)'
                          : 'var(--grnInk)'
                        : 'var(--ink3)',
                  }}
                >
                  {describeValue(model, byDate.get(selectedDate)?.value ?? 0)}
                </span>
              </div>

              {selectedSessions.map((session) => (
                <div className={styles.session} key={session.entryId}>
                  <span
                    className={styles.sessionDot}
                    style={{ background: isNegative ? 'var(--crim)' : 'var(--grn)' }}
                    aria-hidden="true"
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className={`${styles.sessionTime} num`}>
                      {sessionTimeLabel(session, model)}
                    </div>
                    <div className={styles.sessionNote}>{session.note || 'No note'}</div>
                  </div>
                  <div className={styles.grow} />
                  <button
                    type="button"
                    className={styles.sessionEdit}
                    onClick={() => setEditing(session)}
                  >
                    Edit
                    <span className="visuallyHidden">
                      {' '}
                      entry at {sessionTimeLabel(session, model)}
                    </span>
                  </button>
                </div>
              ))}

              {selectedSessions.length === 0 ? (
                <p className={styles.emptyDay}>
                  {isNegative
                    ? 'No event recorded on this date.'
                    : 'No practice recorded. This is not a confirmed zero — nothing was logged.'}
                </p>
              ) : null}

              <button
                type="button"
                className={styles.addSession}
                onClick={() => setLogging({ date: selectedDate })}
              >
                {isNegative ? '+ Log another event on this day' : '+ Add another session'}
              </button>
            </section>
          ) : null}

          <section className={styles.weekCard} aria-label="Week summary">
            <div className={styles.weekHead}>
              <span className="eyebrow">Week summary</span>
              <div className={styles.grow} />
              <button
                type="button"
                className={styles.weekNav}
                aria-label="Previous week"
                onClick={() => setWeekSelection(addDays(selectedWeekStart, -7))}
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.weekNav}
                aria-label="Next week"
                disabled={selectedWeekStart >= currentWeekStart}
                onClick={() => {
                  const next = addDays(selectedWeekStart, 7)
                  setWeekSelection(next > currentWeekStart ? currentWeekStart : next)
                }}
              >
                ›
              </button>
            </div>

            <div className={styles.weekTitleRow}>
              <span className={styles.weekTitle}>Week {week.range.isoWeek}</span>
              <span className={`${styles.weekRange} num`}>
                {formatMonthDay(week.range.start)}–{formatMonthDay(week.range.end)}
              </span>
            </div>

            <div className={styles.weekStats}>
              {weekStats(model, week, isNegative).map((stat) => (
                <div key={stat.label}>
                  <div className={styles.weekStatValue} style={stat.tone ? { color: stat.tone } : undefined}>
                    {stat.value}
                  </div>
                  <div className={styles.weekStatLabel}>{stat.label}</div>
                </div>
              ))}
            </div>

            {weekGoalNote ? <p className={styles.weekGoalNote}>{weekGoalNote}</p> : null}
          </section>
        </div>

        <div className={styles.side}>
          <GoalPanel
            habit={habit}
            goals={goals}
            byDate={byDate}
            today={today}
            onEdit={(goalId) => setGoalEditor({ goalId })}
          />

          {!isNegative && streak.current > 0 ? (
            <section className="card" aria-label="Current streak days">
              <h2 style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 500, margin: '0 0 14px' }}>
                {pluralize(streak.current, 'day')} current streak
              </h2>
              <div className={styles.dots}>
                {weekRange(today, settings.weekStartsOn).dates.map((date, index) => {
                  const qualifying =
                    date <= today &&
                    (byDate.get(date)?.value ?? 0) >= Math.max(1, habit.streakThreshold)
                  return (
                    <div className={styles.dot} key={date}>
                      <span
                        className={`${styles.dotMark} ${qualifying ? styles.dotMarkOn : ''}`}
                        aria-hidden="true"
                      />
                      <span className={styles.dotLabel}>
                        {WEEKDAY_SHORT_LABELS[(settings.weekStartsOn - 1 + index) % 7]}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p style={{ fontSize: 12.5, color: 'var(--ink2)', margin: '12px 0 0' }}>
                Each dot is a qualifying day in the current week.
              </p>
            </section>
          ) : null}

          {isEmpty ? (
            <section className={styles.emptyState}>
              <h2 style={{ fontFamily: 'var(--serif)', fontSize: 19, fontWeight: 500, margin: 0 }}>
                Nothing recorded yet
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--ink2)', marginTop: 6 }}>
                The heatmap fills in as you log. Add your first entry and today’s cell becomes the
                start of a streak.
              </p>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => setLogging({ date: today })}
              >
                {habit.logLabel}
              </button>
            </section>
          ) : null}
        </div>
      </div>

      <p className={`${styles.tzNote} mono`}>
        {formatZoneName(settings.timezoneId)} · Week runs {weekStartName}–{weekEndName}
      </p>

      <EntryEditor
        open={logging !== null}
        habit={habit}
        entries={entries}
        goals={goals}
        defaultDate={logging?.date ?? today}
        onClose={() => setLogging(null)}
      />

      <EntryEditor
        open={editing !== null}
        habit={habit}
        entries={entries}
        goals={goals}
        entry={editing}
        defaultDate={editing?.occurredLocalDate ?? today}
        onClose={() => setEditing(null)}
      />

      <GoalEditor
        open={goalEditor !== null}
        habit={habit}
        goals={goals}
        goalId={goalEditor?.goalId ?? null}
        onClose={() => setGoalEditor(null)}
      />
    </div>
  )
}

function sessionTimeLabel(entry: EntryViewRow, model: string): string {
  if (entry.startTime === undefined) return 'Time not recorded'
  if (model === 'negative-occurrence') return formatClock(entry.startTime)
  const end = entry.endTime ?? entry.startTime + (model === 'duration' ? entry.value : 45)
  return `${formatClock(entry.startTime)} – ${formatClock(end)} · ${
    model === 'duration' ? formatMinutes(entry.value) : pluralize(entry.value, 'session')
  }`
}

function weekStats(
  model: string,
  week: ReturnType<typeof aggregateWeek>,
  isNegative: boolean,
): Array<{ value: string; label: string; tone?: string }> {
  if (isNegative) {
    return [
      {
        value: String(week.total),
        label: week.total === 1 ? 'event' : 'events',
        tone: week.total ? 'var(--crimInk)' : undefined,
      },
      { value: String(7 - week.activeDays), label: 'clear days' },
    ]
  }
  if (model === 'duration') {
    return [
      { value: formatMinutes(week.total), label: 'total practice time' },
      {
        value: String(week.activeDays),
        label: week.activeDays === 1 ? 'practice day' : 'practice days',
      },
      { value: `${week.averageOverActiveDays} min`, label: 'daily average' },
    ]
  }
  return [
    { value: String(week.total), label: week.total === 1 ? 'session' : 'sessions' },
    { value: String(week.activeDays), label: 'active days' },
  ]
}
