/**
 * Add habit.
 *
 * Reached only from the habit dropdown — there is no Settings screen. Shows a
 * live preview of how the Home header and heatmap will read the new habit.
 */

import { useMemo, useState } from 'react'
import { Sheet } from '../../components/Sheet.tsx'
import { useApp } from '../../app/providers.tsx'
import { useDirtyForm } from '../../app/useDirtyForm.ts'
import { createHabit, defaultLogLabel, PRIVATE_DISPLAY_NAME } from '../../db/repositories/habits.ts'
import { createGoal } from '../../db/repositories/goals.ts'
import { metricForModel } from '../../domain/goals/index.ts'
import type { TrackingModel } from '../../domain/events/types.ts'
import { formatZoneName } from '../../domain/time/format.ts'
import { WEEKDAY_LONG_LABELS } from '../../domain/time/format.ts'
import styles from './HabitSelector.module.css'

const MODELS: Array<{ value: TrackingModel; label: string; hint: string }> = [
  { value: 'duration', label: 'Duration', hint: 'Minutes per session, multiple sessions per day' },
  { value: 'completion', label: 'Completion', hint: 'Done or not done, once per day' },
  { value: 'count', label: 'Count', hint: 'Number of sessions per day' },
  {
    value: 'negative-occurrence',
    label: 'Negative occurrence',
    hint: 'Events you want fewer of, tracked as time since',
  },
]

export interface AddHabitSheetProps {
  open: boolean
  onClose: () => void
  onCreated: (habitId: string) => void
}

/** The form is mounted fresh on open, so a cancelled draft never comes back. */
export function AddHabitSheet(props: AddHabitSheetProps): React.JSX.Element {
  return (
    <Sheet open={props.open} title="Add habit" onClose={props.onClose}>
      <AddHabitForm {...props} />
    </Sheet>
  )
}

function AddHabitForm({ onClose, onCreated }: AddHabitSheetProps): React.JSX.Element {
  const { settings, today, showToast } = useApp()
  const [name, setName] = useState('')
  const [model, setModel] = useState<TrackingModel>('duration')
  const [masked, setMasked] = useState(false)
  const [threshold, setThreshold] = useState('10')
  const [weeklyTarget, setWeeklyTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useDirtyForm(name.trim().length > 0 || masked || weeklyTarget.trim().length > 0)

  const previewName = masked ? PRIVATE_DISPLAY_NAME : name.trim() || 'New habit'
  const negative = model === 'negative-occurrence'

  const previewValue = negative ? '0 days' : model === 'duration' ? '0 min' : 'Not yet'
  const previewLabel = negative ? 'Since last event' : 'Today'
  const previewNote = negative
    ? 'Occurrence days marked in crimson · no-event days stay neutral'
    : `Cells shade by ${model === 'duration' ? 'total minutes' : 'sessions'} in each local day`

  const weekStartLabel = useMemo(
    () => WEEKDAY_LONG_LABELS[settings.weekStartsOn - 1] ?? 'Monday',
    [settings.weekStartsOn],
  )

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!masked && !trimmed) {
      setError('Give the habit a name, or mask it as Private.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const habit = await createHabit({
        displayName: trimmed || PRIVATE_DISPLAY_NAME,
        trackingModel: model,
        isPrivate: masked,
        streakThreshold: Number(threshold) || 1,
        createdLocalDate: today,
        timezoneId: settings.timezoneId,
        logLabel: defaultLogLabel({
          displayName: trimmed,
          trackingModel: model,
          isPrivate: masked,
        }),
      })

      const target = Number(weeklyTarget)
      if (Number.isFinite(target) && target > 0) {
        await createGoal({
          habitId: habit.habitId,
          goalType: negative ? 'periodic-maximum' : 'periodic-minimum',
          metric: metricForModel(model),
          targetValue: model === 'duration' ? Math.round(target * 60) : Math.round(target),
          period: 'week',
          effectiveFromLocalDate: today,
          timezoneId: settings.timezoneId,
          weekStartsOn: settings.weekStartsOn,
        })
      }

      showToast(`${habit.displayName} added · no entries yet`)
      onCreated(habit.habitId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That habit could not be created.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <label className="fieldLabel" htmlFor="new-habit-name">
        Display name
      </label>
      <input
        id="new-habit-name"
        className="field"
        type="text"
        value={name}
        placeholder="e.g. Reading"
        onChange={(e) => setName(e.target.value)}
        disabled={masked}
        aria-describedby={masked ? 'new-habit-masked-note' : undefined}
      />
      {masked ? (
        <span id="new-habit-masked-note" className="errorText" style={{ color: 'var(--ink3)' }}>
          A masked habit is stored and shown only as “Private”.
        </span>
      ) : null}

      <div className="fieldLabel" style={{ marginTop: 16 }} id="new-habit-model-label">
        Tracking model
      </div>
      <div
        role="radiogroup"
        aria-labelledby="new-habit-model-label"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {MODELS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={model === option.value}
            className={`${styles.choice} ${model === option.value ? styles.choiceSelected : ''}`}
            onClick={() => setModel(option.value)}
          >
            <span className={styles.radio} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              <span className={styles.choiceLabel}>{option.label}</span>
              <span className={styles.choiceHint}>{option.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        role="checkbox"
        aria-checked={masked}
        className={styles.checkboxRow}
        onClick={() => setMasked((v) => !v)}
      >
        <span
          className={`${styles.checkboxBox} ${masked ? styles.checkboxBoxOn : ''}`}
          aria-hidden="true"
        >
          {masked ? '✓' : ''}
        </span>
        <span>
          <span className={styles.choiceLabel}>Mask the name as “Private”</span>
          <span className={styles.choiceHint}>
            The real name is never shown in the interface, files, or history.
          </span>
        </span>
      </button>

      <div className={styles.row}>
        <div className={styles.col}>
          <label className="fieldLabel" htmlFor="new-habit-threshold">
            Streak qualifies at
          </label>
          <input
            id="new-habit-threshold"
            className="field"
            type="number"
            inputMode="numeric"
            min={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <div className={styles.col}>
          <label className="fieldLabel" htmlFor="new-habit-goal">
            {negative ? 'Weekly maximum (optional)' : 'Weekly goal (optional)'}
          </label>
          <input
            id="new-habit-goal"
            className="field"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.25"
            placeholder={model === 'duration' ? 'hours per week' : 'per week'}
            value={weeklyTarget}
            onChange={(e) => setWeeklyTarget(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.previewCard}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Preview
        </div>
        <div className={styles.previewName}>{previewName}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 500 }}>
            {previewValue}
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{previewLabel}</span>
        </div>
        <div className={styles.previewCells} aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={styles.previewCell} />
          ))}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 10 }}>
          {previewNote}
        </div>
      </div>

      <div className="mono" style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 14 }}>
        {formatZoneName(settings.timezoneId)} · Weeks run {weekStartLabel}–
        {WEEKDAY_LONG_LABELS[(settings.weekStartsOn + 5) % 7] ?? 'Sunday'}
      </div>

      {error ? (
        <p className="noticeBad" style={{ marginTop: 14 }} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="button" className={`btnSecondary ${styles.actionsShrink}`} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`btnPrimary ${styles.actionsGrow}`}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Creating…' : 'Create habit'}
        </button>
      </div>
    </>
  )
}
