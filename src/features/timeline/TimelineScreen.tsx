/**
 * Timeline: what happened, and what changed about the record of what happened.
 *
 * Entries groups by local date. Changes shows the immutable audit log. On
 * laptop the selected entry fills a persistent right pane; on mobile it opens a
 * sheet.
 */

import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../../app/providers.tsx'
import { useIsNarrow } from '../../app/useMediaQuery.ts'
import { useHabitData, useHabitList } from '../useHabitData.ts'
import { HabitSelector } from '../habit-selector/HabitSelector.tsx'
import { EntryEditor } from '../entry-editor/EntryEditor.tsx'
import { Sheet } from '../../components/Sheet.tsx'
import { ScreenFallback } from '../../components/ScreenFallback.tsx'
import { deleteEntry, restoreEntry } from '../../db/repositories/entries.ts'
import { eventsForEntity, eventsForHabit } from '../../db/repositories/dataTransfer.ts'
import { db } from '../../db/database.ts'
import type { EntryViewRow } from '../../db/schema.ts'
import type { DomainEvent, EntrySnapshot, TrackingModel } from '../../domain/events/types.ts'
import { replayOrder } from '../../domain/events/heads.ts'
import { describeValue } from '../../domain/heatmap/index.ts'
import type { LocalDate } from '../../domain/time/civil.ts'
import { addDays, diffDays } from '../../domain/time/civil.ts'
import {
  formatClock,
  formatInstant,
  formatInstantClock,
  formatMinutes,
  formatMonthDay,
  formatRelativeDay,
  pluralize,
} from '../../domain/time/format.ts'
import { describeEvent, toneColor } from './describeEvent.ts'
import styles from './TimelineScreen.module.css'

/** Recent days are shown even when empty, so gaps in a streak are legible. */
const RECENT_WINDOW_DAYS = 9
const MAX_GROUPS = 30

export function TimelineScreen(): React.JSX.Element {
  const { habitId } = useParams<{ habitId: string }>()
  const { settings, today, showToast } = useApp()
  const habits = useHabitList()
  const data = useHabitData(habitId, today)
  const narrow = useIsNarrow()

  const [tab, setTab] = useState<'entries' | 'changes'>('entries')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)
  const [editing, setEditing] = useState<EntryViewRow | null>(null)
  const [logging, setLogging] = useState(false)

  const changes = useLiveQuery(async () => {
    if (!habitId || tab !== 'changes') return undefined
    return eventsForHabit(habitId, 120)
  }, [habitId, tab])

  const auditEvents = useLiveQuery(async () => {
    if (!selectedId) return undefined
    return eventsForEntity(selectedId)
  }, [selectedId])

  const deviceLabels = useLiveQuery(async () => {
    const rows = await db().devices.toArray()
    return new Map(rows.map((d) => [d.deviceId, d.isThisDevice ? 'This device' : d.label]))
  }, [])

  const groups = useMemo(() => {
    if (!data.habit) return []
    return buildGroups(data.entries, data.byDate, today, data.habit.trackingModel)
  }, [data.entries, data.byDate, data.habit, today])

  if (!data.loaded || habits === undefined) return <ScreenFallback label="Loading this habit…" />
  const habit = data.habit
  if (!habit) return <ScreenFallback label="That habit is no longer here." />

  const isNegative = data.isNegative
  const model = habit.trackingModel
  const selected = data.entries.find((e) => e.entryId === selectedId) ?? null

  const openEntry = (entry: EntryViewRow): void => {
    setSelectedId(entry.entryId)
    if (narrow) setDetailSheetOpen(true)
  }

  const removeEntry = async (entry: EntryViewRow): Promise<void> => {
    await deleteEntry(entry.entryId)
    setDetailSheetOpen(false)
    setSelectedId(null)
    showToast('Entry deleted · tombstone recorded', {
      action: {
        label: 'Undo',
        run: async () => {
          await restoreEntry(entry.entryId)
          showToast('Entry restored')
        },
      },
    })
  }

  const detail = selected ? (
    <EntryDetail
      entry={selected}
      model={model}
      isNegative={isNegative}
      timezoneId={settings.timezoneId}
      today={today}
      events={auditEvents ?? []}
      deviceLabels={deviceLabels ?? new Map()}
      onEdit={() => {
        setDetailSheetOpen(false)
        setEditing(selected)
      }}
      onDelete={() => void removeEntry(selected)}
    />
  ) : null

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <HabitSelector habit={habit} habits={habits} routeSuffix="/timeline" />
          <div className={styles.pageLabel}>Timeline</div>
        </div>
        <div className={styles.grow} />
        <button type="button" className="btnPrimary" onClick={() => setLogging(true)}>
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>
            +
          </span>
          {habit.logLabel}
        </button>
      </div>

      <div className={styles.split}>
        <div className="card" style={{ padding: 16 }}>
          <div className={styles.tabs} role="tablist" aria-label="Timeline view">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'entries'}
              className={`${styles.tab} ${tab === 'entries' ? styles.tabActive : ''}`}
              onClick={() => setTab('entries')}
            >
              Entries
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'changes'}
              className={`${styles.tab} ${tab === 'changes' ? styles.tabActive : ''}`}
              onClick={() => setTab('changes')}
            >
              Changes
            </button>
          </div>

          {tab === 'entries' ? (
            <div>
              {groups.map((group) => (
                <div className={styles.group} key={group.date}>
                  <div className={styles.groupHead}>
                    <span className={styles.groupDay}>{formatRelativeDay(group.date, today)}</span>
                    <span className={`${styles.groupDate} num`}>{formatMonthDay(group.date)}</span>
                    <div className={styles.grow} />
                    {group.rows.length ? (
                      <span
                        className={styles.groupTotal}
                        style={{ color: isNegative ? 'var(--crimInk)' : 'var(--ink)' }}
                      >
                        {describeValue(model, group.total)}
                      </span>
                    ) : null}
                  </div>

                  {group.rows.length === 0 ? (
                    <p className={styles.groupEmpty}>
                      {isNegative
                        ? 'No event recorded'
                        : model === 'duration'
                          ? 'No practice recorded'
                          : 'No session recorded'}
                    </p>
                  ) : null}

                  {group.rows.map((row) => (
                    <button
                      type="button"
                      key={row.entryId}
                      className={`${styles.row} ${selectedId === row.entryId ? styles.rowSelected : ''}`}
                      aria-current={selectedId === row.entryId ? 'true' : undefined}
                      onClick={() => openEntry(row)}
                    >
                      <span
                        className={styles.rowDot}
                        style={{ background: isNegative ? 'var(--crim)' : 'var(--grn)' }}
                        aria-hidden="true"
                      />
                      <span className={styles.rowBody}>
                        <span className={`${styles.rowTime} num`}>
                          {timeLabel(row, model, isNegative)}
                        </span>
                        <span className={styles.rowMeta}>
                          Recorded {formatInstantClock(row.createdAt, settings.timezoneId)} ·{' '}
                          {deviceLabels?.get(row.deviceId) ?? 'This device'}
                          {row.note ? ` · ${row.note}` : ''}
                        </span>
                        {row.version > 1 ? (
                          <span className={styles.rowEdited}>
                            Edited · {pluralize(row.version - 1, 'change')} in history
                          </span>
                        ) : null}
                        {row.conflicted ? (
                          <span className={styles.rowEdited}>
                            Unresolved conflict · excluded from totals
                          </span>
                        ) : null}
                      </span>
                      <span className={`${styles.rowValue} num`}>
                        {describeValue(model, row.value)}
                      </span>
                      <span className={styles.rowChevron} aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ))}
                </div>
              ))}

              {groups.length === 0 ? (
                <p className={styles.noneMessage}>No entries in this range yet.</p>
              ) : null}
            </div>
          ) : (
            <ChangesList
              events={changes}
              model={model}
              timezoneId={settings.timezoneId}
              deviceLabels={deviceLabels ?? new Map()}
            />
          )}
        </div>

        {!narrow ? (
          <div className="card">
            {detail ?? (
              <p className={styles.placeholder}>
                Select an entry to see its detail and full change history.
              </p>
            )}
          </div>
        ) : null}
      </div>

      {narrow ? (
        <Sheet
          open={detailSheetOpen && selected !== null}
          title="Entry detail"
          onClose={() => setDetailSheetOpen(false)}
        >
          {detail}
        </Sheet>
      ) : null}

      <EntryEditor
        open={logging}
        habit={habit}
        entries={data.entries}
        goals={data.goals}
        defaultDate={today}
        onClose={() => setLogging(false)}
      />

      <EntryEditor
        open={editing !== null}
        habit={habit}
        entries={data.entries}
        goals={data.goals}
        entry={editing}
        defaultDate={editing?.occurredLocalDate ?? today}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

interface EntryGroup {
  date: LocalDate
  total: number
  rows: EntryViewRow[]
}

/**
 * Recent dates appear even when empty so a broken streak is visible; older
 * dates appear only when something happened, so ten years of history does not
 * become thousands of empty rows.
 */
function buildGroups(
  entries: readonly EntryViewRow[],
  byDate: ReadonlyMap<LocalDate, { value: number }>,
  today: LocalDate,
  model: TrackingModel,
): EntryGroup[] {
  void model
  const live = entries.filter((e) => !e.deleted)
  const byDay = new Map<LocalDate, EntryViewRow[]>()
  for (const entry of live) {
    const list = byDay.get(entry.occurredLocalDate)
    if (list) list.push(entry)
    else byDay.set(entry.occurredLocalDate, [entry])
  }

  const dates = new Set<LocalDate>(byDay.keys())
  for (let i = 0; i < RECENT_WINDOW_DAYS; i += 1) dates.add(addDays(today, -i))

  return [...dates]
    .filter((date) => date <= today)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .filter((date) => byDay.has(date) || diffDays(today, date) < RECENT_WINDOW_DAYS)
    .slice(0, MAX_GROUPS)
    .map((date) => ({
      date,
      total: byDate.get(date)?.value ?? 0,
      rows: (byDay.get(date) ?? []).sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0)),
    }))
}

function timeLabel(
  entry: EntryViewRow,
  model: TrackingModel,
  isNegative: boolean,
): string {
  if (entry.startTime === undefined) return 'Time not recorded'
  if (isNegative) return formatClock(entry.startTime)
  const end = entry.endTime ?? entry.startTime + (model === 'duration' ? entry.value : 45)
  return `${formatClock(entry.startTime)} – ${formatClock(end)}`
}

function ChangesList({
  events,
  model,
  timezoneId,
  deviceLabels,
}: {
  events: DomainEvent[] | undefined
  model: TrackingModel
  timezoneId: string
  deviceLabels: Map<string, string>
}): React.JSX.Element {
  const described = useMemo(() => {
    if (!events) return []
    // Replay order gives each edit the snapshot it replaced, so the copy can say
    // what changed rather than just that something did.
    const ordered = replayOrder(events)
    const previousByEntity = new Map<string, EntrySnapshot>()
    const rows = ordered.map((event) => {
      const previous = previousByEntity.get(event.entityId)
      const row = describeEvent(event, model, previous)
      if (event.entityType === 'entry') {
        previousByEntity.set(event.entityId, event.payload as EntrySnapshot)
      }
      return row
    })
    return rows.reverse()
  }, [events, model])

  if (events === undefined) return <ScreenFallback label="Loading changes…" />
  if (!described.length) {
    return <p className={styles.noneMessage}>Nothing has changed for this habit yet.</p>
  }

  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {described.map((change) => (
        <li className={styles.change} key={change.eventId}>
          <span
            className={styles.changeDot}
            style={{ background: toneColor(change.tone) }}
            aria-hidden="true"
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={styles.changeTitle}>{change.title}</div>
            {change.detail ? <div className={styles.changeDetail}>{change.detail}</div> : null}
            <div className={styles.changeMeta}>
              Recorded {formatInstant(change.recordedAt, timezoneId)} ·{' '}
              {deviceLabels.get(change.deviceId) ?? 'This device'}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function EntryDetail({
  entry,
  model,
  isNegative,
  timezoneId,
  today,
  events,
  deviceLabels,
  onEdit,
  onDelete,
}: {
  entry: EntryViewRow
  model: TrackingModel
  isNegative: boolean
  timezoneId: string
  today: LocalDate
  events: DomainEvent[]
  deviceLabels: Map<string, string>
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const audit = events.map((event) => ({
    eventId: event.eventId,
    what: auditVerb(event.eventType),
    when: `${formatInstant(event.recordedAt, timezoneId)} · ${
      deviceLabels.get(event.deviceId) ?? 'This device'
    }`,
  }))

  return (
    <div>
      <div className={styles.detailHead}>
        <span className={styles.detailDay}>{formatRelativeDay(entry.occurredLocalDate, today)}</span>
        <span style={{ fontSize: 13, color: 'var(--ink2)' }}>
          {formatMonthDay(entry.occurredLocalDate)}
        </span>
      </div>

      <div className={styles.detailValue}>
        {model === 'duration' ? formatMinutes(entry.value) : describeValue(model, entry.value)}
      </div>
      <div className={`${styles.detailTime} num`}>{timeLabel(entry, model, isNegative)}</div>

      {entry.conflicted ? (
        <p className={`noticeWarn ${styles.conflictBanner}`}>
          <span className="badge" aria-hidden="true">
            !
          </span>
          <span>
            Two devices edited this entry. It is excluded from totals until the conflict is resolved
            on the Data screen.
          </span>
        </p>
      ) : null}

      <div className={styles.detailBlock}>
        <div className="eyebrow">Note</div>
        <p className={styles.detailNote}>{entry.note || 'No note'}</p>
      </div>

      <div className={styles.detailBlock}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Audit trail
        </div>
        {audit.map((row) => (
          <div className={styles.auditRow} key={row.eventId}>
            <span className={styles.auditWhat}>{row.what}</span>
            <span className={styles.auditWhen}>{row.when}</span>
          </div>
        ))}
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12.5, color: 'var(--ink2)', cursor: 'pointer' }}>
            Technical details
          </summary>
          <div className={styles.technical}>Entity ID {entry.entryId}</div>
          <div className={styles.technical}>Version {entry.version}</div>
          <div className={styles.technical}>
            Head {entry.headEventIds.join(', ') || '—'}
          </div>
          {entry.sourceEntryId ? (
            <div className={styles.technical}>Split from entry {entry.sourceEntryId}</div>
          ) : null}
        </details>
      </div>

      <div className={styles.detailActions}>
        <button
          type="button"
          className={`btnPrimary ${styles.detailAction}`}
          onClick={onEdit}
          disabled={entry.conflicted}
        >
          Edit entry
        </button>
        <button
          type="button"
          className={`btnDanger ${styles.detailAction}`}
          onClick={onDelete}
          disabled={entry.conflicted}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function auditVerb(eventType: DomainEvent['eventType']): string {
  switch (eventType) {
    case 'entry.created':
      return 'Created'
    case 'entry.updated':
      return 'Edited'
    case 'entry.deleted':
      return 'Deleted'
    case 'entry.restored':
      return 'Restored'
    case 'conflict.resolved':
      return 'Resolved'
    default:
      return 'Changed'
  }
}
