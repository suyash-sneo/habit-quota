/**
 * The habit title *is* the selector.
 *
 * There are deliberately no chips, no second dropdown, and no habit toolbar —
 * the large page title opens a sheet listing the habits plus the two focused
 * flows that replace a Settings screen.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sheet } from '../../components/Sheet.tsx'
import { ChevronDown, LockIcon } from '../../components/icons.tsx'
import type { HabitViewRow } from '../../db/schema.ts'
import { AddHabitSheet } from './AddHabitSheet.tsx'
import { ManageHabitsSheet } from './ManageHabitsSheet.tsx'
import styles from './HabitSelector.module.css'

export interface HabitSelectorProps {
  habit: HabitViewRow
  habits: HabitViewRow[]
  /** Appended to the habit path so Timeline stays on Timeline when switching. */
  routeSuffix?: '' | '/timeline'
}

type OpenSheet = null | 'choose' | 'add' | 'manage'

export function HabitSelector({
  habit,
  habits,
  routeSuffix = '',
}: HabitSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState<OpenSheet>(null)
  const navigate = useNavigate()

  const select = (habitId: string): void => {
    setOpen(null)
    navigate(`/habit/${habitId}${routeSuffix}`)
  }

  return (
    <>
      <button
        type="button"
        className={styles.title}
        aria-haspopup="dialog"
        aria-expanded={open === 'choose'}
        onClick={() => setOpen('choose')}
      >
        {habit.isPrivate ? <LockIcon height="0.72em" /> : null}
        <span className={styles.name}>{habit.displayName}</span>
        <ChevronDown />
        <span className="visuallyHidden">— change habit</span>
      </button>

      <Sheet open={open === 'choose'} title="Choose habit" onClose={() => setOpen(null)}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {habits.map((option) => {
            const selected = option.habitId === habit.habitId
            return (
              <li key={option.habitId}>
                <button
                  type="button"
                  className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => select(option.habitId)}
                >
                  {option.isPrivate ? (
                    <span style={{ color: 'var(--ink2)', display: 'inline-flex' }}>
                      <LockIcon height={16} />
                    </span>
                  ) : null}
                  <span className={styles.optionBody}>
                    <span className={styles.optionName}>{option.displayName}</span>
                    <span className={styles.optionUnit}>{unitLabel(option)}</span>
                  </span>
                  <span className={styles.check} aria-hidden="true">
                    {selected ? '✓' : ''}
                  </span>
                  {selected ? <span className="visuallyHidden">Selected</span> : null}
                </button>
              </li>
            )
          })}
        </ul>

        <div className={styles.divider} />
        <button type="button" className={styles.quietAction} onClick={() => setOpen('add')}>
          Add habit
        </button>
        <button type="button" className={styles.quietAction} onClick={() => setOpen('manage')}>
          Manage habits
        </button>
      </Sheet>

      <AddHabitSheet
        open={open === 'add'}
        onClose={() => setOpen(null)}
        onCreated={(habitId) => select(habitId)}
      />

      <ManageHabitsSheet open={open === 'manage'} onClose={() => setOpen(null)} />
    </>
  )
}

export function unitLabel(habit: Pick<HabitViewRow, 'unit'>): string {
  switch (habit.unit) {
    case 'minutes':
      return 'Minutes'
    case 'sessions':
      return 'Sessions'
    case 'count':
      return 'Count'
    case 'events':
      return 'Events'
  }
}
