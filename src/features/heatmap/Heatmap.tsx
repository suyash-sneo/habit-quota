/**
 * The contribution grid.
 *
 * A semantic button per day and per week header, arrow-key navigation between
 * adjacent days, and intensity carried by a CSS class rather than an inline
 * colour so a year of cells costs nothing to paint.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DayAggregate } from '../../domain/habits/aggregate.ts'
import type { TrackingModel } from '../../domain/events/types.ts'
import { buildHeatmap, legendFor } from '../../domain/heatmap/index.ts'
import type { IntensityBucket } from '../../domain/heatmap/index.ts'
import type { IsoWeekday, LocalDate } from '../../domain/time/civil.ts'
import { addDays, weekdayOf } from '../../domain/time/civil.ts'
import { WEEKDAY_SHORT_LABELS } from '../../domain/time/format.ts'
import styles from './Heatmap.module.css'

const BUCKET_CLASS: Record<string, string> = {
  '0': styles.b0 as string,
  '1': styles.b1 as string,
  '2': styles.b2 as string,
  '3': styles.b3 as string,
  '4': styles.b4 as string,
  '5': styles.b5 as string,
  negative: styles.bneg as string,
}

function bucketClass(bucket: IntensityBucket): string {
  return BUCKET_CLASS[String(bucket)] ?? (styles.b0 as string)
}

export interface HeatmapProps {
  byDate: ReadonlyMap<LocalDate, DayAggregate>
  model: TrackingModel
  today: LocalDate
  weekStartsOn: IsoWeekday
  weekCount: number
  selectedDate: LocalDate | null
  selectedWeekStart: LocalDate | null
  onSelectDate: (date: LocalDate) => void
  onSelectWeek: (weekStart: LocalDate) => void
  title: string
  unitLabel: string
}

export function Heatmap({
  byDate,
  model,
  today,
  weekStartsOn,
  weekCount,
  selectedDate,
  selectedWeekStart,
  onSelectDate,
  onSelectWeek,
  title,
  unitLabel,
}: HeatmapProps): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const scrolledOnce = useRef(false)

  const grid = useMemo(
    () => buildHeatmap({ byDate, model, today, weekStartsOn, weekCount }),
    [byDate, model, today, weekStartsOn, weekCount],
  )

  const legend = useMemo(() => legendFor(model), [model])

  // The newest weeks matter most, so start scrolled to the right on mobile.
  useEffect(() => {
    if (scrolledOnce.current) return
    const node = scroller.current
    if (!node) return
    node.scrollLeft = node.scrollWidth
    scrolledOnce.current = true
  }, [grid])

  const focusCell = useCallback((date: LocalDate) => {
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-heat-date="${date}"]`)
      target?.focus()
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }, [])

  const onCellKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, date: LocalDate) => {
      const moves: Record<string, number> = {
        ArrowRight: 7,
        ArrowLeft: -7,
        ArrowDown: 1,
        ArrowUp: -1,
        PageDown: 7,
        PageUp: -7,
      }
      const delta = moves[event.key]
      if (delta !== undefined) {
        event.preventDefault()
        let next = addDays(date, delta)
        if (next > today) next = today
        if (next < grid.firstDate) next = grid.firstDate
        onSelectDate(next)
        focusCell(next)
        return
      }
      if (event.key === 'Home') {
        event.preventDefault()
        const start = addDays(date, -((weekdayOf(date) - weekStartsOn + 7) % 7))
        onSelectDate(start > today ? today : start)
        focusCell(start > today ? today : start)
      }
      if (event.key === 'End') {
        event.preventDefault()
        onSelectDate(today)
        focusCell(today)
      }
    },
    [focusCell, grid.firstDate, onSelectDate, today, weekStartsOn],
  )

  // Exactly one cell is tabbable, so Tab skips past the grid in one press.
  const tabStop = selectedDate && selectedDate <= today ? selectedDate : today

  const dayLabels = useMemo(() => {
    const labels: string[] = []
    for (let i = 0; i < 7; i += 1) {
      labels.push(WEEKDAY_SHORT_LABELS[(weekStartsOn - 1 + i) % 7] as string)
    }
    return labels
  }, [weekStartsOn])

  return (
    <section aria-label={title}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.spacer} />
        <div className={styles.legend}>
          {legend.map((stop) => (
            <div className={styles.legendStop} key={String(stop.bucket)}>
              <span
                className={`${styles.legendSwatch} ${bucketClass(stop.bucket)}`}
                aria-hidden="true"
              />
              <span>{stop.label}</span>
            </div>
          ))}
          {unitLabel ? <span style={{ marginLeft: 2 }}>{unitLabel}</span> : null}
        </div>
      </div>

      <div className={styles.scroller} ref={scroller}>
        <div className={styles.grid}>
          <div className={styles.dayLabels} aria-hidden="true">
            <div className={styles.dayLabelSpacer} />
            {dayLabels.map((label) => (
              <div className={styles.dayLabel} key={label}>
                {label}
              </div>
            ))}
          </div>

          {grid.weeks.map((week) => {
            const weekSelected = week.range.start === selectedWeekStart
            return (
              <div
                className={`${styles.week} ${weekSelected ? styles.weekSelected : ''}`}
                key={week.range.key}
              >
                <button
                  type="button"
                  className={`${styles.weekTab} ${weekSelected ? styles.weekTabSelected : ''}`}
                  aria-label={week.accessibleLabel}
                  aria-pressed={weekSelected}
                  onClick={() => onSelectWeek(week.range.start)}
                >
                  {week.label}
                </button>

                {week.cells.map((cell) => {
                  const selected = cell.localDate === selectedDate && !cell.isFuture
                  return (
                    <div className={styles.cellWrap} key={cell.localDate}>
                      <button
                        type="button"
                        data-heat-date={cell.localDate}
                        className={[
                          styles.cell,
                          cell.isFuture ? styles.cellFuture : bucketClass(cell.intensityBucket),
                          selected ? styles.cellSelected : '',
                          cell.hasConflict ? styles.conflict : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        disabled={cell.isFuture}
                        tabIndex={cell.localDate === tabStop ? 0 : -1}
                        aria-label={
                          cell.hasConflict
                            ? `${cell.accessibleLabel}, unresolved conflict`
                            : cell.accessibleLabel
                        }
                        aria-pressed={selected}
                        title={cell.accessibleLabel}
                        onClick={() => onSelectDate(cell.localDate)}
                        onKeyDown={(event) => onCellKeyDown(event, cell.localDate)}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      <p className={styles.rangeNote}>
        Last {weekCount} weeks · scroll for older weeks · arrow keys move between days
      </p>
    </section>
  )
}
