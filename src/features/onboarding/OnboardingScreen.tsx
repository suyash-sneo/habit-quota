/**
 * First launch.
 *
 * Confirms the two calendar rules the whole app depends on, then creates the
 * first habit. It also offers Import, because a returning user on a new device
 * has a backup rather than a blank slate.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../app/providers.tsx'
import { HelpTip } from '../../components/HelpTip.tsx'
import { thresholdCopy } from '../streak-threshold.ts'
import { createHabit, defaultLogLabel, PRIVATE_DISPLAY_NAME } from '../../db/repositories/habits.ts'
import { createGoal } from '../../db/repositories/goals.ts'
import { metricForModel } from '../../domain/goals/index.ts'
import type { TrackingModel } from '../../domain/events/types.ts'
import type { IsoWeekday } from '../../domain/time/civil.ts'
import { formatZoneName, WEEKDAY_LONG_LABELS } from '../../domain/time/format.ts'
import { deviceTimezone, isSupportedTimezone } from '../../domain/time/zone.ts'
import { seedDemoData, seedingAvailable } from '../../db/seed.ts'
import selectorStyles from '../habit-selector/HabitSelector.module.css'
import styles from './OnboardingScreen.module.css'

const MODELS: Array<{ value: TrackingModel; label: string; hint: string }> = [
  { value: 'duration', label: 'Duration', hint: 'Minutes per session, several sessions a day' },
  { value: 'completion', label: 'Completion', hint: 'Done or not done, once a day' },
  { value: 'count', label: 'Count', hint: 'A number of sessions each day' },
  {
    value: 'negative-occurrence',
    label: 'Negative occurrence',
    hint: 'Something you want fewer of, tracked as time since',
  },
]

export function OnboardingScreen(): React.JSX.Element {
  const { settings, today, updateSettings, showToast } = useApp()
  const navigate = useNavigate()
  const heading = useRef<HTMLHeadingElement>(null)

  const [timezoneId, setTimezoneId] = useState(settings.timezoneId || deviceTimezone())
  const [weekStartsOn, setWeekStartsOn] = useState<IsoWeekday>(settings.weekStartsOn)
  const [name, setName] = useState('')
  const [model, setModel] = useState<TrackingModel>('duration')
  const [masked, setMasked] = useState(false)
  const [threshold, setThreshold] = useState('10')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streakCopy = thresholdCopy(model)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  const start = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!masked && !trimmed) {
      setError('Give your first habit a name, or mask it as Private.')
      return
    }
    if (!isSupportedTimezone(timezoneId)) {
      setError('That is not a timezone this browser recognises.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      await updateSettings({ timezoneId, weekStartsOn, onboardedAt: new Date().toISOString() })
      const habit = await createHabit({
        displayName: trimmed || PRIVATE_DISPLAY_NAME,
        trackingModel: model,
        isPrivate: masked,
        streakThreshold: Number(threshold) || 1,
        createdLocalDate: today,
        timezoneId,
        logLabel: defaultLogLabel({ displayName: trimmed, trackingModel: model, isPrivate: masked }),
      })

      if (model === 'negative-occurrence') {
        await createGoal({
          habitId: habit.habitId,
          goalType: 'periodic-maximum',
          metric: metricForModel(model),
          targetValue: 2,
          period: 'week',
          effectiveFromLocalDate: today,
          timezoneId,
          weekStartsOn,
        })
      }

      navigate(`/habit/${habit.habitId}`, { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Setup could not be completed.')
      setBusy(false)
    }
  }

  const seed = async (): Promise<void> => {
    setBusy(true)
    try {
      await updateSettings({ timezoneId, weekStartsOn, onboardedAt: new Date().toISOString() })
      await seedDemoData({ today, timezoneId, weekStartsOn })
      showToast('Synthetic demo data created')
      navigate('/', { replace: true })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Demo data could not be created.')
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <h1 className={styles.title} tabIndex={-1} ref={heading}>
          Habits
        </h1>
        <p className={styles.lede}>
          Everything you log stays in this browser. There is no account and no server — data leaves
          this device only in a backup file you create yourself.
        </p>

        <section className={styles.section} aria-label="Calendar rules">
          <h2 className={styles.sectionTitle}>Your calendar</h2>
          <p className={styles.sectionHint}>
            Streaks, weekly totals and deadlines are all counted in local days, so these two
            settings decide what “today” and “this week” mean.
          </p>
          <div className={selectorStyles.row}>
            <div className={selectorStyles.col} style={{ minWidth: 180 }}>
              <label className="fieldLabel" htmlFor="onboard-timezone">
                Timezone
              </label>
              <input
                id="onboard-timezone"
                className="field"
                type="text"
                value={timezoneId}
                onChange={(e) => setTimezoneId(e.target.value)}
                aria-describedby="onboard-timezone-help"
              />
              <span id="onboard-timezone-help" className="errorText" style={{ color: 'var(--ink3)' }}>
                {isSupportedTimezone(timezoneId)
                  ? formatZoneName(timezoneId)
                  : 'Not a recognised IANA zone'}
              </span>
            </div>
            <div className={selectorStyles.col} style={{ minWidth: 160 }}>
              <label className="fieldLabel" htmlFor="onboard-week-start">
                Week starts on
              </label>
              <select
                id="onboard-week-start"
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
        </section>

        <section className={styles.section} aria-label="First habit">
          <h2 className={styles.sectionTitle}>Your first habit</h2>
          <label className="fieldLabel" htmlFor="onboard-name">
            Display name
          </label>
          <input
            id="onboard-name"
            className="field"
            type="text"
            value={name}
            placeholder="e.g. Reading"
            disabled={masked}
            onChange={(e) => setName(e.target.value)}
          />

          <div className="fieldLabel" style={{ marginTop: 16 }} id="onboard-model-label">
            Tracking model
          </div>
          <div
            role="radiogroup"
            aria-labelledby="onboard-model-label"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            {MODELS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={model === option.value}
                className={`${selectorStyles.choice} ${model === option.value ? selectorStyles.choiceSelected : ''}`}
                onClick={() => setModel(option.value)}
              >
                <span className={selectorStyles.radio} aria-hidden="true" />
                <span style={{ minWidth: 0 }}>
                  <span className={selectorStyles.choiceLabel}>{option.label}</span>
                  <span className={selectorStyles.choiceHint}>{option.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            role="checkbox"
            aria-checked={masked}
            className={selectorStyles.checkboxRow}
            onClick={() => setMasked((v) => !v)}
          >
            <span
              className={`${selectorStyles.checkboxBox} ${masked ? selectorStyles.checkboxBoxOn : ''}`}
              aria-hidden="true"
            >
              {masked ? '✓' : ''}
            </span>
            <span>
              <span className={selectorStyles.choiceLabel}>Mask the name as “Private”</span>
              <span className={selectorStyles.choiceHint}>
                The real name is never stored, shown, or written into a backup.
              </span>
            </span>
          </button>

          {streakCopy.applies ? (
            <div style={{ marginTop: 14 }}>
              <span className="labelRow">
                <label className="fieldLabel" htmlFor="onboard-threshold">
                  {streakCopy.label}
                </label>
                <HelpTip id="onboard-threshold-help" label={streakCopy.label}>
                  {streakCopy.explanation}
                </HelpTip>
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <input
                  id="onboard-threshold"
                  className="field num"
                  style={{ width: 140, flex: '0 0 auto' }}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  aria-describedby="onboard-threshold-help"
                />
                <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>{streakCopy.unit}</span>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 14 }}>
              {streakCopy.explanation}
            </p>
          )}
        </section>

        {error ? (
          <p className="noticeBad" role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className="btnPrimary" onClick={() => void start()} disabled={busy}>
            {busy ? 'Setting up…' : 'Start tracking'}
          </button>
          <button
            type="button"
            className="btnSecondary"
            onClick={() => navigate('/data')}
            disabled={busy}
          >
            Import a backup instead
          </button>
        </div>

        {seedingAvailable() ? (
          <button
            type="button"
            className="btnQuiet"
            style={{ marginTop: 16 }}
            onClick={() => void seed()}
            disabled={busy}
          >
            Create synthetic demo data (development build only)
          </button>
        ) : null}
      </div>
    </main>
  )
}
