/**
 * Add or edit a goal, plus the streak threshold and the calendar rules that
 * would otherwise need a Settings screen.
 *
 * A changed goal applies to future calculations; the previous definition stays
 * in the event log so past weeks still explain themselves.
 */

import { useState } from 'react'
import { Sheet } from '../../components/Sheet.tsx'
import { HelpTip } from '../../components/HelpTip.tsx'
import { thresholdCopy } from '../streak-threshold.ts'
import { useApp } from '../../app/providers.tsx'
import { useDirtyForm } from '../../app/useDirtyForm.ts'
import { createGoal, deleteGoal, updateGoal } from '../../db/repositories/goals.ts'
import { updateHabit } from '../../db/repositories/habits.ts'
import { metricForModel } from '../../domain/goals/index.ts'
import type { GoalSnapshot, GoalType } from '../../domain/events/types.ts'
import type { GoalViewRow, HabitViewRow } from '../../db/schema.ts'
import type { IsoWeekday } from '../../domain/time/civil.ts'
import { formatZoneName, WEEKDAY_LONG_LABELS } from '../../domain/time/format.ts'
import { deviceTimezone, isSupportedTimezone } from '../../domain/time/zone.ts'
import selectorStyles from '../habit-selector/HabitSelector.module.css'

interface GoalTypeOption {
  value: GoalType
  label: string
  hint: string
}

const GOAL_TYPES: GoalTypeOption[] = [
  {
    value: 'cumulative-by-deadline',
    label: 'Cumulative by deadline',
    hint: 'Total amount to reach before a date',
  },
  { value: 'periodic-minimum', label: 'Periodic minimum', hint: 'At least this much every period' },
  {
    value: 'periodic-maximum',
    label: 'Periodic maximum',
    hint: 'No more than this many every period',
  },
]

export interface GoalEditorProps {
  open: boolean
  habit: HabitViewRow
  goals: readonly GoalViewRow[]
  /** Null creates a new goal. */
  goalId: string | null
  onClose: () => void
}

/**
 * The sheet mounts {@link GoalForm} fresh each time it opens, so the fields
 * always reflect the goal being edited rather than the last one touched.
 */
export function GoalEditor(props: GoalEditorProps): React.JSX.Element {
  const { open, goals, goalId, onClose } = props
  const existing = goals.find((g) => g.goalId === goalId) ?? null
  return (
    <Sheet open={open} title={existing ? 'Edit goals' : 'Add a goal'} onClose={onClose}>
      <GoalForm key={goalId ?? 'new'} {...props} />
    </Sheet>
  )
}

function GoalForm({ habit, goals, goalId, onClose }: GoalEditorProps): React.JSX.Element {
  const { settings, today, updateSettings, showToast } = useApp()
  const existing = goals.find((g) => g.goalId === goalId) ?? null
  const negative = habit.trackingModel === 'negative-occurrence'
  const duration = habit.trackingModel === 'duration'

  const [goalType, setGoalType] = useState<GoalType>(
    existing?.goalType ?? (negative ? 'periodic-maximum' : 'periodic-minimum'),
  )
  const [amount, setAmount] = useState(() => {
    if (!existing) return negative ? '2' : duration ? '5' : '4'
    // Durations are entered in hours but stored in minutes.
    const isDurationTarget = duration && existing.goalType !== 'periodic-maximum'
    return isDurationTarget
      ? String(Math.round((existing.targetValue / 60) * 100) / 100)
      : String(existing.targetValue)
  })
  const [deadline, setDeadline] = useState(
    existing?.deadlineLocalDate ?? `${today.slice(0, 4)}-12-31`,
  )
  const [threshold, setThreshold] = useState(String(habit.streakThreshold))
  const [timezoneId, setTimezoneId] = useState(settings.timezoneId)
  const [weekStartsOn, setWeekStartsOn] = useState<IsoWeekday>(settings.weekStartsOn)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threshold_copy = thresholdCopy(habit.trackingModel)

  useDirtyForm(!saving)

  // Durations are entered in hours and stored in minutes.
  const unitLabel =
    duration && goalType !== 'periodic-maximum' ? 'Hours' : negative ? 'Events' : 'Sessions'

  const toTargetValue = (): number => {
    const raw = Number(amount)
    if (!Number.isFinite(raw) || raw <= 0) return 0
    return duration && goalType !== 'periodic-maximum' ? Math.round(raw * 60) : Math.round(raw)
  }

  const save = async (): Promise<void> => {
    const targetValue = toTargetValue()
    if (targetValue <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (!isSupportedTimezone(timezoneId)) {
      setError('That is not a timezone this browser recognises.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (settings.timezoneId !== timezoneId || settings.weekStartsOn !== weekStartsOn) {
        await updateSettings({ timezoneId, weekStartsOn })
      }
      if (Number(threshold) !== habit.streakThreshold) {
        await updateHabit(habit.habitId, { streakThreshold: Number(threshold) }, timezoneId)
      }

      const base: Omit<GoalSnapshot, 'goalId' | 'active'> = {
        habitId: habit.habitId,
        goalType,
        metric: metricForModel(habit.trackingModel),
        targetValue,
        ...(goalType === 'cumulative-by-deadline'
          ? { deadlineLocalDate: deadline }
          : { period: 'week' as const }),
        effectiveFromLocalDate: existing?.effectiveFromLocalDate ?? today,
        timezoneId,
        weekStartsOn,
      }

      if (existing) await updateGoal(existing.goalId, { ...base, active: true })
      else await createGoal(base)

      showToast('Goal updated · applies to future calculations')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That goal could not be saved.')
      setSaving(false)
    }
  }

  const retire = async (): Promise<void> => {
    if (!existing) return
    setSaving(true)
    try {
      await deleteGoal(existing.goalId, today)
      showToast('Goal retired · past weeks keep their old target')
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That goal could not be retired.')
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fieldLabel" id="goal-type-label">
        Goal type
      </div>
      <div
        role="radiogroup"
        aria-labelledby="goal-type-label"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {GOAL_TYPES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={goalType === option.value}
            className={`${selectorStyles.choice} ${goalType === option.value ? selectorStyles.choiceSelected : ''}`}
            onClick={() => setGoalType(option.value)}
          >
            <span className={selectorStyles.radio} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <span className={selectorStyles.choiceLabel}>{option.label}</span>
              <span className={selectorStyles.choiceHint}>{option.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className={selectorStyles.row}>
        <div className={selectorStyles.col} style={{ minWidth: 120 }}>
          <label className="fieldLabel" htmlFor="goal-amount">
            Amount
          </label>
          <input
            id="goal-amount"
            className="field num"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.25"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className={selectorStyles.col} style={{ minWidth: 120 }}>
          <span className="fieldLabel">Unit</span>
          <div className="fieldReadonly">{unitLabel}</div>
        </div>
        <div className={selectorStyles.col} style={{ minWidth: 150 }}>
          {goalType === 'cumulative-by-deadline' ? (
            <>
              <label className="fieldLabel" htmlFor="goal-deadline">
                Deadline
              </label>
              <input
                id="goal-deadline"
                className="field"
                type="date"
                value={deadline}
                min={today}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </>
          ) : (
            <>
              <span className="fieldLabel">Period</span>
              <div className="fieldReadonly">Every week</div>
            </>
          )}
        </div>
      </div>

      <div className={selectorStyles.row}>
        <div className={selectorStyles.col} style={{ minWidth: 150 }}>
          <label className="fieldLabel" htmlFor="goal-timezone">
            Timezone
          </label>
          <input
            id="goal-timezone"
            className="field"
            type="text"
            list="goal-timezone-options"
            value={timezoneId}
            onChange={(e) => setTimezoneId(e.target.value)}
            aria-describedby="goal-timezone-help"
          />
          <datalist id="goal-timezone-options">
            <option value={deviceTimezone()} />
            <option value="UTC" />
            <option value="America/Los_Angeles" />
            <option value="America/New_York" />
            <option value="Europe/London" />
            <option value="Asia/Kolkata" />
            <option value="Asia/Tokyo" />
          </datalist>
          <span id="goal-timezone-help" className="errorText" style={{ color: 'var(--ink3)' }}>
            {isSupportedTimezone(timezoneId)
              ? formatZoneName(timezoneId)
              : 'Not a recognised IANA zone'}
          </span>
        </div>
        <div className={selectorStyles.col} style={{ minWidth: 150 }}>
          <label className="fieldLabel" htmlFor="goal-week-start">
            Week starts
          </label>
          <select
            id="goal-week-start"
            className="field"
            value={weekStartsOn}
            onChange={(e) => setWeekStartsOn(Number(e.target.value) as IsoWeekday)}
          >
            {WEEKDAY_LONG_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {threshold_copy.applies ? (
        <div style={{ marginTop: 14 }}>
          <span className="labelRow">
            <label className="fieldLabel" htmlFor="goal-threshold">
              {threshold_copy.label}
            </label>
            <HelpTip id="goal-threshold-help" label={threshold_copy.label}>
              {threshold_copy.explanation}
            </HelpTip>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              id="goal-threshold"
              className="field num"
              style={{ width: 110, flex: '0 0 auto' }}
              type="number"
              inputMode="numeric"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              aria-describedby="goal-threshold-help"
            />
            <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>{threshold_copy.unit}</span>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 14 }}>
          {threshold_copy.explanation}
        </p>
      )}

      <p style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 14 }}>
        Changes apply to future calculations. The previous goal definition is kept in the change
        history.
      </p>

      {error ? (
        <p className="noticeBad" style={{ marginTop: 14 }} role="alert">
          {error}
        </p>
      ) : null}

      <div className={selectorStyles.actions}>
        {existing ? (
          <button
            type="button"
            className="btnDanger"
            onClick={() => void retire()}
            disabled={saving}
          >
            Retire goal
          </button>
        ) : null}
        <button
          type="button"
          className={`btnSecondary ${selectorStyles.actionsShrink}`}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`btnPrimary ${selectorStyles.actionsGrow}`}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save goal'}
        </button>
      </div>
    </>
  )
}
