/**
 * One typed form shell with model-specific fields.
 *
 * Creating is meant to be two taps. Editing is deliberately slower: it shows
 * what the change does to the day total, the week, the streak and the goal
 * before it is saved, because those consequences are otherwise invisible.
 */

import { useMemo, useState } from 'react'
import { Sheet } from '../../components/Sheet.tsx'
import { useApp } from '../../app/providers.tsx'
import { useDirtyForm } from '../../app/useDirtyForm.ts'
import { createEntry, deleteEntry, restoreEntry, updateEntry } from '../../db/repositories/entries.ts'
import type { EntryViewRow, GoalViewRow, HabitViewRow } from '../../db/schema.ts'
import { aggregateByDate, aggregateWeek } from '../../domain/habits/aggregate.ts'
import type { DayAggregate } from '../../domain/habits/aggregate.ts'
import { evaluateGoal } from '../../domain/goals/index.ts'
import { describeValue } from '../../domain/heatmap/index.ts'
import type { IsoWeekday, LocalDate } from '../../domain/time/civil.ts'
import {
  formatMinutes,
  formatMonthDay,
  fromTimeInputValue,
  toTimeInputValue,
} from '../../domain/time/format.ts'
import { isoWeekOf, startOfWeek } from '../../domain/time/week.ts'
import { positiveStreak, streakThresholdFor } from '../../domain/streaks/index.ts'
import styles from './EntryEditor.module.css'

const QUICK_MINUTES = [15, 30, 45, 60]

export interface EntryEditorProps {
  open: boolean
  habit: HabitViewRow
  /** Existing rows for this habit — used to preview the consequences of an edit. */
  entries: readonly EntryViewRow[]
  goals: readonly GoalViewRow[]
  /** Omit to create; pass a row to edit it. */
  entry?: EntryViewRow | null
  defaultDate: LocalDate
  onClose: () => void
}

/**
 * Opening the sheet mounts {@link EntryForm} fresh, so a half-typed draft can
 * never leak from one entry into the next. No reset effect is needed.
 */
export function EntryEditor(props: EntryEditorProps): React.JSX.Element {
  const { open, habit, entry, onClose } = props
  const editing = Boolean(entry)
  const negative = habit.trackingModel === 'negative-occurrence'
  const duration = habit.trackingModel === 'duration'

  const title = editing
    ? 'Edit entry'
    : negative
      ? 'Log event'
      : duration
        ? habit.logLabel
        : 'Log session'

  return (
    <Sheet
      open={open}
      title={title}
      onClose={onClose}
      description={
        editing
          ? 'Editing records a new event. History is preserved.'
          : negative
            ? 'Recorded privately on this device only.'
            : 'Preselected for today. Two taps is the whole flow.'
      }
    >
      <EntryForm key={entry?.entryId ?? 'new'} {...props} />
    </Sheet>
  )
}

function EntryForm({
  habit,
  entries,
  goals,
  entry,
  defaultDate,
  onClose,
}: EntryEditorProps): React.JSX.Element {
  const { settings, today, showToast } = useApp()
  const editing = Boolean(entry)
  const negative = habit.trackingModel === 'negative-occurrence'
  const duration = habit.trackingModel === 'duration'
  const completion = habit.trackingModel === 'completion'

  const initialStart = negative ? 22 * 60 + 15 : 18 * 60 + 15

  const [value, setValue] = useState(() =>
    entry ? String(entry.value) : duration ? '25' : '1',
  )
  const [date, setDate] = useState<LocalDate>(entry?.occurredLocalDate ?? defaultDate)
  const [note, setNote] = useState(entry?.note ?? '')
  const [start, setStart] = useState(() =>
    entry ? (entry.startTime === undefined ? '' : toTimeInputValue(entry.startTime)) : toTimeInputValue(initialStart),
  )
  const [end, setEnd] = useState(() => {
    if (entry) return entry.endTime === undefined ? '' : toTimeInputValue(entry.endTime)
    return toTimeInputValue(initialStart + (duration ? 25 : 45))
  })
  const [marked, setMarked] = useState(Boolean(entry))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const numericValue = Math.max(0, Math.round(Number(value) || 0))
  const startMinutes = fromTimeInputValue(start)
  const endMinutes = fromTimeInputValue(end)
  const span =
    startMinutes !== null && endMinutes !== null && endMinutes > startMinutes
      ? endMinutes - startMinutes
      : null

  const mismatch = duration && span !== null && span !== numericValue

  const dirty =
    (editing
      ? numericValue !== entry?.value ||
        date !== entry?.occurredLocalDate ||
        note !== (entry?.note ?? '')
      : note.trim().length > 0 || (duration && numericValue !== 25) || date !== defaultDate)
  useDirtyForm(dirty)

  const consequences = useEntryConsequences({
    enabled: editing,
    habit,
    entries,
    goals,
    entry: entry ?? null,
    nextValue: completion || negative ? 1 : numericValue,
    nextDate: date,
    today,
    weekStartsOn: settings.weekStartsOn,
  })

  const save = async (): Promise<void> => {
    if (mismatch) {
      setError('Resolve the start and end times before saving.')
      return
    }
    const amount = duration ? numericValue : 1
    if (duration && amount <= 0) {
      setError('Enter a duration greater than zero.')
      return
    }
    if (completion && !editing && !marked) {
      setError('Mark the session complete first.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (entry) {
        await updateEntry(entry.entryId, {
          value: amount,
          occurredLocalDate: date,
          note,
          startTime: startMinutes ?? undefined,
          endTime: duration ? (endMinutes ?? undefined) : undefined,
        })
        showToast('Entry updated · change recorded in history')
      } else {
        const created = await createEntry({
          habitId: habit.habitId,
          occurredLocalDate: date,
          timezoneId: settings.timezoneId,
          value: amount,
          unit: habit.unit,
          startTime: startMinutes ?? undefined,
          endTime: duration ? (endMinutes ?? undefined) : undefined,
          note,
        })
        showToast(
          negative
            ? `Event recorded · ${formatMonthDay(date)}`
            : `${describeValue(habit.trackingModel, amount)} added · ${formatMonthDay(date)}`,
          {
            action: {
              label: 'Undo',
              run: async () => {
                await deleteEntry(created.entryId)
                showToast('Entry removed', {
                  action: {
                    label: 'Redo',
                    run: async () => {
                      await restoreEntry(created.entryId)
                    },
                  },
                })
              },
            },
          },
        )
      }
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That entry could not be saved.')
      setSaving(false)
    }
  }

  return (
    <>
      {duration ? (
        <>
          <div className="fieldLabel" id="entry-duration-label">
            Duration
          </div>
          <div className={styles.quickRow} role="group" aria-labelledby="entry-duration-label">
            {QUICK_MINUTES.map((minutes) => (
              <button
                key={minutes}
                type="button"
                className={`${styles.quick} ${numericValue === minutes ? styles.quickSelected : ''}`}
                aria-pressed={numericValue === minutes}
                onClick={() => {
                  setValue(String(minutes))
                  if (startMinutes !== null) setEnd(toTimeInputValue(startMinutes + minutes))
                }}
              >
                {minutes} min
              </button>
            ))}
          </div>

          <div className={styles.inlineRow}>
            <input
              className={`field ${styles.narrowField} num`}
              id="entry-minutes"
              type="number"
              inputMode="numeric"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <label htmlFor="entry-minutes" style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
              minutes
            </label>
          </div>

          <div className={styles.row}>
            <div className={styles.col}>
              <label className="fieldLabel" htmlFor="entry-start">
                Start
              </label>
              <input
                id="entry-start"
                className="field"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className={styles.col}>
              <label className="fieldLabel" htmlFor="entry-end">
                End
              </label>
              <input
                id="entry-end"
                className="field"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {mismatch && span !== null ? (
            <div className={`noticeWarn ${styles.mismatch}`} role="alert">
              <span className="badge" aria-hidden="true">
                !
              </span>
              <span style={{ flex: 1 }}>
                Start and end times span {span} min but duration says {numericValue} min. Resolve
                before saving.
              </span>
              <button
                type="button"
                className={styles.useTimes}
                onClick={() => setValue(String(span))}
              >
                Use times
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {(completion || habit.trackingModel === 'count') && !editing ? (
        <>
          <button
            type="button"
            className={`${styles.completeButton} ${marked ? styles.completeButtonOn : ''}`}
            aria-pressed={marked}
            onClick={() => setMarked((v) => !v)}
          >
            {marked ? '✓ Marked complete' : 'Mark complete'}
          </button>
          <p style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 9 }}>
            {marked
              ? 'Marked complete. Save again only if this is a separate, intentional session.'
              : 'One tap records today as complete.'}
          </p>
        </>
      ) : null}

      {negative && !editing ? (
        <div className={styles.negativePanel}>
          <p style={{ fontSize: 13.5, color: 'var(--ink)', margin: 0 }}>
            One occurrence will be recorded at the date and time below. This resets the
            time-since-last-event count.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--ink2)', margin: '8px 0 0' }}>
            Resets “since last event” to 0 days · counts toward this week’s maximum
          </p>
        </div>
      ) : null}

      {editing && !duration ? (
        <div className={styles.inlineRow}>
          <input
            id="entry-count"
            className={`field ${styles.narrowField} num`}
            type="number"
            inputMode="numeric"
            min={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <label htmlFor="entry-count" style={{ fontSize: 13.5, color: 'var(--ink2)' }}>
            {habit.unit}
          </label>
        </div>
      ) : null}

      <div className={styles.row}>
        <div className={styles.col} style={{ minWidth: 150 }}>
          <label className="fieldLabel" htmlFor="entry-date">
            Local date
          </label>
          <input
            id="entry-date"
            className="field"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate((e.target.value || today) as LocalDate)}
          />
        </div>
        {negative ? (
          <div className={styles.col}>
            <label className="fieldLabel" htmlFor="entry-time">
              Time
            </label>
            <input
              id="entry-time"
              className="field"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 14 }}>
        <label className="fieldLabel" htmlFor="entry-note">
          {negative ? 'Private note (optional)' : 'Note (optional)'}
        </label>
        <textarea
          id="entry-note"
          className="field"
          rows={2}
          value={note}
          placeholder={negative ? 'Stays on this device' : 'e.g. Scales and bowing'}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {editing && consequences.length ? (
        <div className={styles.consequences}>
          <div className="eyebrow" style={{ color: 'var(--ambInk)', marginBottom: 10 }}>
            If you save this change
          </div>
          {consequences.map((row) => (
            <div className={styles.consequenceRow} key={row.label}>
              <span className={styles.consequenceLabel}>{row.label}</span>
              <span style={{ color: 'var(--ink2)' }}>{row.from}</span>
              <span className={styles.arrow} aria-label="becomes">
                →
              </span>
              <span className={styles.to}>{row.to}</span>
            </div>
          ))}
          <p style={{ fontSize: 12.5, color: 'var(--ink2)', margin: '10px 0 0' }}>
            Editing records a new audit event. The original values stay in the change history.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="noticeBad" style={{ marginTop: 14 }} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={`btnSecondary ${styles.cancel}`} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`btnPrimary ${styles.save} ${negative && !editing ? styles.saveNegative : ''}`}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Saving…' : editing ? 'Save change' : negative ? 'Log event' : 'Save entry'}
        </button>
      </div>
    </>
  )
}

interface Consequence {
  label: string
  from: string
  to: string
}

/**
 * What the edit would do, computed by re-running the same aggregation on a copy
 * of the rows with the change applied. No special-case arithmetic.
 */
function useEntryConsequences(options: {
  enabled: boolean
  habit: HabitViewRow
  entries: readonly EntryViewRow[]
  goals: readonly GoalViewRow[]
  entry: EntryViewRow | null
  nextValue: number
  nextDate: LocalDate
  today: LocalDate
  weekStartsOn: IsoWeekday
}): Consequence[] {
  const { enabled, habit, entries, goals, entry, nextValue, nextDate, today, weekStartsOn } = options

  return useMemo(() => {
    if (!enabled || !entry) return []
    const unchanged = nextValue === entry.value && nextDate === entry.occurredLocalDate
    if (unchanged) return []

    const before = aggregateByDate(entries, habit.trackingModel)
    const after = aggregateByDate(
      entries.map((row) =>
        row.entryId === entry.entryId
          ? { ...row, value: nextValue, occurredLocalDate: nextDate }
          : row,
      ),
      habit.trackingModel,
    )

    const describe = (map: ReadonlyMap<LocalDate, DayAggregate>, date: LocalDate): string =>
      describeValue(habit.trackingModel, map.get(date)?.value ?? 0)

    const out: Consequence[] = [
      {
        label: `${formatMonthDay(entry.occurredLocalDate)} total`,
        from: describe(before, entry.occurredLocalDate),
        to: describe(after, entry.occurredLocalDate),
      },
    ]

    if (nextDate !== entry.occurredLocalDate) {
      out.push({
        label: `${formatMonthDay(nextDate)} total`,
        from: describe(before, nextDate),
        to: describe(after, nextDate),
      })
      out.push({
        label: 'Heatmap cell',
        from: `${formatMonthDay(entry.occurredLocalDate)} · W${isoWeekOf(startOfWeek(entry.occurredLocalDate, weekStartsOn)).isoWeek}`,
        to: `${formatMonthDay(nextDate)} · W${isoWeekOf(startOfWeek(nextDate, weekStartsOn)).isoWeek}`,
      })
    }

    const weekBefore = aggregateWeek(before, entry.occurredLocalDate, weekStartsOn, today)
    const weekAfter = aggregateWeek(after, entry.occurredLocalDate, weekStartsOn, today)
    if (weekBefore.total !== weekAfter.total) {
      out.push({
        label: `W${weekBefore.range.isoWeek} total`,
        from: describeValue(habit.trackingModel, weekBefore.total),
        to: describeValue(habit.trackingModel, weekAfter.total),
      })
    }

    if (habit.trackingModel !== 'negative-occurrence') {
      const threshold = streakThresholdFor(habit.trackingModel, habit.streakThreshold)
      const streakBefore = positiveStreak(before, today, threshold)
      const streakAfter = positiveStreak(after, today, threshold)
      if (streakBefore.current !== streakAfter.current) {
        out.push({
          label: 'Current streak',
          from: `${streakBefore.current} days`,
          to: `${streakAfter.current} days`,
        })
      }
    }

    const cumulative = goals.find((g) => g.active && g.goalType === 'cumulative-by-deadline')
    if (cumulative) {
      const goalBefore = evaluateGoal(cumulative, before, today)
      const goalAfter = evaluateGoal(cumulative, after, today)
      if (goalBefore.progress !== goalAfter.progress) {
        out.push({
          label: 'Goal progress',
          from: formatMinutes(goalBefore.progress),
          to: formatMinutes(goalAfter.progress),
        })
      }
    }

    return out
  }, [enabled, habit, entries, goals, entry, nextValue, nextDate, today, weekStartsOn])
}
