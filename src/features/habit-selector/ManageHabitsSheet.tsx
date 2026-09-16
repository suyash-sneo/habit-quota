/**
 * Manage habits: reorder, rename, archive and restore.
 *
 * Archiving keeps every event and keeps the habit in exports — it only removes
 * it from the dropdown.
 */

import { useState } from 'react'
import { Sheet } from '../../components/Sheet.tsx'
import { useApp } from '../../app/providers.tsx'
import { useHabitList } from '../useHabitData.ts'
import {
  archiveHabit,
  moveHabit,
  restoreHabit,
  updateHabit,
} from '../../db/repositories/habits.ts'
import styles from './HabitSelector.module.css'

export function ManageHabitsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { settings, showToast } = useApp()
  const habits = useHabitList(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = habits ?? []

  const run = async (work: () => Promise<void>, message?: string): Promise<void> => {
    setBusy(true)
    try {
      await work()
      if (message) showToast(message)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'That change could not be saved.', {
        tone: 'bad',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      title="Manage habits"
      onClose={onClose}
      description="Reorder, rename, or archive. Changing a tracking model never rewrites existing history."
    >
      {rows.map((habit, index) => (
        <div className={styles.manageRow} key={habit.habitId}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Move ${habit.displayName} up`}
            disabled={busy || index === 0}
            onClick={() => void run(() => moveHabit(habit.habitId, -1, settings.timezoneId))}
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Move ${habit.displayName} down`}
            disabled={busy || index === rows.length - 1}
            onClick={() => void run(() => moveHabit(habit.habitId, 1, settings.timezoneId))}
          >
            ↓
          </button>

          <div style={{ minWidth: 0, flex: 1 }}>
            {renaming === habit.habitId ? (
              <>
                <label className="visuallyHidden" htmlFor={`rename-${habit.habitId}`}>
                  New name for {habit.displayName}
                </label>
                <input
                  id={`rename-${habit.habitId}`}
                  className="field"
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void run(async () => {
                        await updateHabit(
                          habit.habitId,
                          { displayName: draftName },
                          settings.timezoneId,
                        )
                        setRenaming(null)
                      }, 'Name updated')
                    }
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              </>
            ) : (
              <>
                <div className={styles.manageName}>{habit.displayName}</div>
                <div className={styles.manageMeta}>
                  {habit.unit} ·{' '}
                  {habit.trackingModel === 'negative-occurrence'
                    ? 'negative occurrence'
                    : habit.trackingModel}
                  {habit.archived ? ' · archived' : ''}
                </div>
              </>
            )}
          </div>

          {habit.isPrivate ? null : (
            <button
              type="button"
              className={styles.archiveButton}
              disabled={busy}
              onClick={() => {
                if (renaming === habit.habitId) {
                  void run(async () => {
                    await updateHabit(habit.habitId, { displayName: draftName }, settings.timezoneId)
                    setRenaming(null)
                  }, 'Name updated')
                } else {
                  setDraftName(habit.displayName)
                  setRenaming(habit.habitId)
                }
              }}
            >
              {renaming === habit.habitId ? 'Save' : 'Rename'}
            </button>
          )}

          <button
            type="button"
            className={styles.archiveButton}
            disabled={busy}
            style={habit.archived ? { color: 'var(--grnInk)' } : undefined}
            onClick={() =>
              void run(
                () =>
                  habit.archived
                    ? restoreHabit(habit.habitId, settings.timezoneId)
                    : archiveHabit(habit.habitId, settings.timezoneId),
                habit.archived ? 'Habit restored' : 'Habit archived · events kept',
              )
            }
          >
            {habit.archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      ))}

      <p className={styles.footnote}>
        Archived habits keep all of their events and stay available in exports.
      </p>
    </Sheet>
  )
}
