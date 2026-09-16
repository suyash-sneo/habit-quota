/**
 * Every active goal for the selected habit, and nothing from any other habit.
 */

import { useMemo } from 'react'
import type { DayAggregate } from '../../domain/habits/aggregate.ts'
import { activeGoalsOn, evaluateGoal } from '../../domain/goals/index.ts'
import type { GoalViewRow, HabitViewRow } from '../../db/schema.ts'
import type { LocalDate } from '../../domain/time/civil.ts'
import { presentGoal, toneColor, toneInkColor } from './presentation.ts'
import styles from './GoalPanel.module.css'

export interface GoalPanelProps {
  habit: HabitViewRow
  goals: readonly GoalViewRow[]
  byDate: ReadonlyMap<LocalDate, DayAggregate>
  today: LocalDate
  onEdit: (goalId: string | null) => void
}

export function GoalPanel({ habit, goals, byDate, today, onEdit }: GoalPanelProps): React.JSX.Element {
  const cards = useMemo(() => {
    const active = activeGoalsOn(goals, habit.habitId, today)
    return active.map((goal) => ({
      goal,
      presentation: presentGoal(goal, evaluateGoal(goal, byDate, today), habit.trackingModel, today),
    }))
  }, [goals, habit.habitId, habit.trackingModel, byDate, today])

  if (!cards.length) {
    return (
      <div className={styles.emptyCard}>
        <div className={styles.emptyTitle}>No goal set</div>
        <p className={styles.emptyBody}>
          A goal turns the heatmap into a target: a weekly minimum, a total by a deadline, or a
          weekly limit for something you want less of.
        </p>
        <button type="button" className="btnSecondary" onClick={() => onEdit(null)}>
          Add a goal
        </button>
      </div>
    )
  }

  return (
    <>
      {cards.map(({ goal, presentation }) => (
        <section className="card" key={goal.goalId} aria-label={presentation.heading}>
          <div className={styles.header}>
            <h2 className={styles.heading}>{presentation.heading}</h2>
            <div className={styles.spacer} />
            <button type="button" className="btnQuiet" onClick={() => onEdit(goal.goalId)}>
              Edit goals
            </button>
          </div>
          <p className={styles.subheading}>{presentation.subheading}</p>

          <div className={styles.bigRow}>
            <span className={styles.big} style={{ color: toneColor(presentation.tone) }}>
              {presentation.big}
            </span>
            <span className={styles.bigSuffix}>{presentation.bigSuffix}</span>
          </div>

          <div className={styles.progressRow}>
            <div
              className={styles.track}
              role="progressbar"
              aria-label={`${presentation.heading} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={presentation.percent}
              aria-valuetext={`${presentation.percentLabel} — ${presentation.statusLabel}`}
            >
              <div
                className={styles.fill}
                style={{
                  width: `${presentation.percent}%`,
                  background: toneColor(presentation.tone),
                }}
              />
            </div>
            <span className={`${styles.percent} num`}>{presentation.percentLabel}</span>
          </div>

          <p className={styles.status}>{presentation.statusLabel}</p>

          <div className={styles.lines}>
            {presentation.lines.map((line) => (
              <div className={styles.line} key={line.key}>
                <span
                  className={`${styles.lineValue} num`}
                  style={line.tone ? { color: toneInkColor(line.tone) } : undefined}
                >
                  {line.value}
                </span>
                <span className={styles.lineLabel}>{line.label}</span>
              </div>
            ))}
          </div>

          <p className={`${styles.footnote} mono`}>{presentation.footnote}</p>
        </section>
      ))}
    </>
  )
}
