/**
 * The totals panel: one named window at a time, its headline numbers, and a
 * column chart of how the window was actually spent.
 *
 * It reads the same day aggregates every other screen reads and writes
 * nothing, so switching windows can never alter a record.
 *
 * Two averages sit side by side deliberately. "Per day" divides by every day in
 * the window; "per active day" divides only by days that carry a record. The
 * app's position is that a blank day is not a confirmed zero, so neither number
 * alone is the honest one.
 */

import { useMemo, useState } from 'react'
import { useIsNarrow } from '../../app/useMediaQuery.ts'
import type { DayAggregate } from '../../domain/habits/aggregate.ts'
import {
  bucketSeries,
  chooseBucketUnit,
  firstRecordedDate,
  periodRanges,
  periodStats,
} from '../../domain/habits/periods.ts'
import type { PeriodKey, PeriodStats, SeriesBucket } from '../../domain/habits/periods.ts'
import type { TrackingModel } from '../../domain/events/types.ts'
import { isNegativeModel } from '../../domain/events/types.ts'
import type { IsoWeekday, LocalDate } from '../../domain/time/civil.ts'
import { addDays, maxDate, minDate } from '../../domain/time/civil.ts'
import {
  formatMinutes,
  formatMonthDay,
  formatMonthDayYear,
  formatWeekdayShort,
  pluralize,
} from '../../domain/time/format.ts'
import { startOfWeek, weekRange } from '../../domain/time/week.ts'
import styles from './PracticeDashboard.module.css'

/** The chart is 140px tall; a logged day never renders as nothing at all. */
const PLOT_HEIGHT = 140
const MIN_VISIBLE_PERCENT = 2

export interface PracticeDashboardProps {
  byDate: ReadonlyMap<LocalDate, DayAggregate>
  model: TrackingModel
  today: LocalDate
  weekStartsOn: IsoWeekday
  /** Day the habit was created, so a window cannot predate the habit itself. */
  createdLocalDate: LocalDate
  periodKey: PeriodKey
  onPeriodChange: (key: PeriodKey) => void
  /**
   * The week the `week` window reports on. Shared with the heatmap, so
   * stepping weeks here moves the highlight there and vice versa.
   */
  selectedWeekStart: LocalDate
  onSelectWeek: (weekStart: LocalDate) => void
  /** Daily buckets are clickable; this opens the day detail below. */
  onSelectDate: (date: LocalDate) => void
  /** Progress line for an active weekly goal, shown only on the week window. */
  weekGoalNote?: string | null
}

export function PracticeDashboard({
  byDate,
  model,
  today,
  weekStartsOn,
  createdLocalDate,
  periodKey,
  onPeriodChange,
  selectedWeekStart,
  onSelectWeek,
  onSelectDate,
  weekGoalNote,
}: PracticeDashboardProps): React.JSX.Element {
  const [hovered, setHovered] = useState<number | null>(null)
  // A phone has room for about four axis labels; a laptop for twice that.
  const maxTicks = useIsNarrow() ? 4 : 8

  const isNegative = isNegativeModel(model)
  const currentWeekStart = startOfWeek(today, weekStartsOn)

  const ranges = useMemo(() => {
    const recorded = firstRecordedDate(byDate)
    // The habit's own creation date bounds lifetime even when it was
    // back-filled with older entries — whichever reaches further back wins.
    const floor = recorded === null ? createdLocalDate : min(recorded, createdLocalDate)
    const base = periodRanges(today, weekStartsOn, min(floor, today))
    // The week window is navigable, so it reports on whichever week is
    // selected rather than always on the one containing today.
    return base.map((r) => {
      if (r.key !== 'week') return r
      const start = maxDate(selectedWeekStart, min(floor, today))
      return {
        ...r,
        nominalStart: selectedWeekStart,
        start,
        end: minDate(addDays(selectedWeekStart, 6), today),
        clamped: start !== selectedWeekStart,
      }
    })
  }, [byDate, today, weekStartsOn, createdLocalDate, selectedWeekStart])

  const range = ranges.find((r) => r.key === periodKey) ?? (ranges[0] as (typeof ranges)[number])
  const showWeekNav = periodKey === 'week'
  const week = weekRange(selectedWeekStart, weekStartsOn)

  const stats = useMemo(
    () => periodStats(byDate, range.start, range.end),
    [byDate, range.start, range.end],
  )

  const unit = useMemo(() => chooseBucketUnit(range.start, range.end), [range.start, range.end])

  const series = useMemo(
    () => bucketSeries(byDate, range.start, range.end, unit, weekStartsOn),
    [byDate, range.start, range.end, unit, weekStartsOn],
  )

  const peak = series.reduce((high, b) => Math.max(high, b.value), 0)
  const bucketMean = series.length ? series.reduce((s, b) => s + b.value, 0) / series.length : 0
  const tone = isNegative ? styles.negative : styles.positive

  const fmt = (value: number): string => formatValue(model, value)

  return (
    <section className={`card ${styles.panel}`} aria-label="Totals and averages">
      <div className={styles.head}>
        <h2 className={styles.title}>{isNegative ? 'Occurrences' : 'Practice totals'}</h2>
        <div className={styles.grow} />
        <div className={styles.tabs} role="tablist" aria-label="Reporting window">
          {ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={r.key === periodKey}
              className={`${styles.tab} ${r.key === periodKey ? styles.tabOn : ''}`}
              onClick={() => {
                onPeriodChange(r.key)
                setHovered(null)
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {showWeekNav ? (
        <div className={styles.weekNavRow}>
          <button
            type="button"
            className={styles.weekNav}
            aria-label="Previous week"
            onClick={() => onSelectWeek(addDays(selectedWeekStart, -7))}
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
              onSelectWeek(next > currentWeekStart ? currentWeekStart : next)
            }}
          >
            ›
          </button>
          <span className={styles.weekTitle}>
            {selectedWeekStart === currentWeekStart ? 'This week' : `Week ${week.isoWeek}`}
          </span>
          <span className={`${styles.weekRange} num`}>
            {formatMonthDay(week.start)}–{formatMonthDay(week.end)}
          </span>
          {selectedWeekStart === currentWeekStart ? null : (
            <button
              type="button"
              className={styles.weekToday}
              onClick={() => onSelectWeek(currentWeekStart)}
            >
              Back to this week
            </button>
          )}
        </div>
      ) : null}

      <div className={styles.stats} aria-label="Window totals" role="group">
        {statTiles(model, stats, isNegative).map((tile) => (
          <div className={styles.stat} key={tile.label}>
            <div className={`${styles.statValue} ${tile.lead ? styles.statLead : ''}`}>
              {tile.value}
            </div>
            <div className={styles.statLabel}>{tile.label}</div>
            {tile.hint ? <div className={styles.statHint}>{tile.hint}</div> : null}
          </div>
        ))}
      </div>

      <div className={styles.chart}>
        <div className={styles.axis} aria-hidden="true">
          <span>{peak > 0 ? fmt(peak) : ''}</span>
          <span>{peak > 0 ? fmt(0) : ''}</span>
        </div>

        <div className={styles.plotWrap}>
          <div className={styles.plot} style={{ height: PLOT_HEIGHT }}>
            <div className={styles.gridTop} aria-hidden="true" />
            {bucketMean > 0 && peak > 0 ? (
              <div
                className={styles.meanLine}
                style={{ bottom: `${(bucketMean / peak) * 100}%` }}
                aria-hidden="true"
              />
            ) : null}

            {series.map((bucket, index) => {
              const percent =
                peak > 0 && bucket.value > 0
                  ? Math.max(MIN_VISIBLE_PERCENT, (bucket.value / peak) * 100)
                  : 0
              const label = bucketLabel(bucket, unit, model, isNegative)
              const clickable = unit === 'day'
              return (
                <button
                  key={bucket.key}
                  type="button"
                  className={styles.column}
                  aria-label={label}
                  disabled={!clickable}
                  onClick={clickable ? () => onSelectDate(bucket.start) : undefined}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered((h) => (h === index ? null : h))}
                >
                  <span
                    className={`${styles.bar} ${tone} ${bucket.isPartial ? styles.partial : ''} ${
                      bucket.value > 0 ? '' : styles.barEmpty
                    }`}
                    style={{ height: `${percent}%` }}
                  />
                </button>
              )
            })}
          </div>

          <div className={styles.ticks} aria-hidden="true">
            {tickLabels(series, unit, maxTicks).map((label, index) => (
              <span className={styles.tick} key={series[index]?.key ?? index}>
                {label ? <span className={styles.tickLabel}>{label}</span> : null}
              </span>
            ))}
          </div>

          {hovered !== null && series[hovered] ? (
            <div className={styles.tooltip} role="status">
              <span className={styles.tooltipValue}>{fmt((series[hovered] as SeriesBucket).value)}</span>
              <span className={styles.tooltipWhen}>
                {bucketWhen(series[hovered] as SeriesBucket, unit)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {bucketMean > 0 ? (
        <p className={styles.legend}>
          <span className={styles.legendLine} aria-hidden="true" />
          avg {fmt(bucketMean)} per {unit}
          <span className={styles.legendSep} aria-hidden="true">
            ·
          </span>
          <span className={styles.legendSwatch} data-tone={isNegative ? 'negative' : 'positive'} aria-hidden="true" />
          {bucketWord(unit)} total
        </p>
      ) : null}

      <p className={styles.footnote}>{footnote(model, stats, range.clamped, range.start, isNegative)}</p>
      {showWeekNav && weekGoalNote ? <p className={styles.goalNote}>{weekGoalNote}</p> : null}
    </section>
  )
}

function min(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b
}

/** Minutes read as hours and minutes; everything else is a plain count. */
function formatValue(model: TrackingModel, value: number): string {
  if (model === 'duration') return formatMinutes(value)
  const rounded = Math.round(value * 10) / 10
  return String(rounded)
}

function unitWord(model: TrackingModel, value: number): string {
  if (model === 'duration') return ''
  if (model === 'negative-occurrence') return value === 1 ? 'event' : 'events'
  if (model === 'count') return value === 1 ? 'unit' : 'units'
  return value === 1 ? 'session' : 'sessions'
}

interface StatTile {
  value: string
  label: string
  hint?: string
  lead?: boolean
}

function statTiles(model: TrackingModel, stats: PeriodStats, isNegative: boolean): StatTile[] {
  const fmt = (v: number): string => formatValue(model, v)

  if (isNegative) {
    return [
      { value: fmt(stats.total), label: `total ${unitWord(model, stats.total)}`.trim(), lead: true },
      { value: String(stats.elapsedDays - stats.activeDays), label: 'clear days' },
      { value: String(stats.activeDays), label: 'days with an event' },
      { value: fmt(stats.averagePerElapsedDay), label: 'per day' },
    ]
  }

  const tiles: StatTile[] = [
    {
      value: fmt(stats.total),
      label: model === 'duration' ? 'total practice' : `total ${unitWord(model, stats.total)}`,
      lead: true,
    },
    {
      value: fmt(stats.averagePerElapsedDay),
      label: 'per day',
      hint: `over ${pluralize(stats.elapsedDays, 'day')}`,
    },
    {
      value: fmt(stats.averagePerActiveDay),
      label: 'per active day',
      hint: `over ${pluralize(stats.activeDays, 'logged day')}`,
    },
  ]

  // A percentile over ones and twos says nothing; a completion habit's daily
  // value is just how many times the box was ticked.
  if (model === 'duration' || model === 'count') {
    tiles.push({
      value: fmt(stats.p90),
      label: 'p90 day',
      hint: 'top 10% start here',
    })
  } else {
    tiles.push({ value: String(stats.activeDays), label: 'active days' })
  }

  return tiles
}

function footnote(
  model: TrackingModel,
  stats: PeriodStats,
  clamped: boolean,
  start: LocalDate,
  isNegative: boolean,
): string {
  const parts: string[] = []
  if (stats.total === 0) {
    parts.push('Nothing recorded in this window yet.')
  } else if (!isNegative) {
    parts.push(`${stats.activeDays} of ${stats.elapsedDays} days logged`)
  }
  if (stats.bestDate) {
    parts.push(
      `${isNegative ? 'worst' : 'best'} day ${formatValue(model, stats.best)} on ${formatMonthDay(stats.bestDate)}`,
    )
  }
  if (clamped) parts.push(`counted from ${formatMonthDayYear(start)}, where this habit begins`)
  if (stats.hasConflict) parts.push('includes an unresolved entry, so totals are provisional')
  return parts.join(' · ')
}

function bucketWhen(bucket: SeriesBucket, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'day') return `${formatWeekdayShort(bucket.start)}, ${formatMonthDay(bucket.start)}`
  const span = `${formatMonthDay(bucket.start)} – ${formatMonthDay(bucket.end)}`
  return bucket.isPartial ? `${span} · so far` : span
}

function bucketLabel(
  bucket: SeriesBucket,
  unit: 'day' | 'week' | 'month',
  model: TrackingModel,
  isNegative: boolean,
): string {
  const when = bucketWhen(bucket, unit)
  if (bucket.value === 0) {
    return unit === 'day'
      ? `${when}: nothing recorded`
      : `${when}: nothing recorded in ${pluralize(bucket.days, 'day')}`
  }
  const value = `${formatValue(model, bucket.value)} ${unitWord(model, bucket.value)}`.trim()
  if (unit === 'day') return `${when}: ${value}`
  return `${when}: ${value} across ${pluralize(bucket.activeDays, isNegative ? 'day' : 'active day')}`
}

function bucketWord(unit: 'day' | 'week' | 'month'): string {
  return unit === 'day' ? 'Daily' : unit === 'week' ? 'Weekly' : 'Monthly'
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * One label per column, blank where a label would collide. Day columns name
 * their month on the first tick and at every month boundary, so a run reading
 * `29 · 2 · 6` cannot be mistaken for the same month.
 */
function tickLabels(
  series: readonly SeriesBucket[],
  unit: 'day' | 'week' | 'month',
  maxTicks: number,
): string[] {
  const every = series.length <= maxTicks ? 1 : Math.ceil(series.length / maxTicks)
  let lastMonth = ''
  return series.map((bucket, index) => {
    if (index % every !== 0) return ''
    if (unit !== 'day') return bucket.label
    const month = bucket.start.slice(5, 7)
    const changed = month !== lastMonth
    lastMonth = month
    const name = MONTHS_SHORT[Number(month) - 1] ?? ''
    return changed ? `${name} ${bucket.label}` : bucket.label
  })
}
