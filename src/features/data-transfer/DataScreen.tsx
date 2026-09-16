/**
 * Data: what exists on this device, and how it moves.
 *
 * Application-wide, so no habit selector. Nothing is written during an import
 * until the preview has been shown, every conflict has a decision, and a
 * pre-merge snapshot exists.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useApp } from '../../app/providers.tsx'
import { useDirtyForm } from '../../app/useDirtyForm.ts'
import { Sheet } from '../../components/Sheet.tsx'
import { ConflictResolver } from '../conflict-resolution/ConflictResolver.tsx'
import {
  commitImport,
  createSnapshot,
  db,
  deleteAllLocalData,
  restoreSnapshot,
} from '../../db/database.ts'
import {
  allEvents,
  formatBytes,
  integrityReport,
  latestSnapshotId,
  listExports,
  listImports,
  readStorageEstimate,
  recordExport,
  requestPersistentStorage,
} from '../../db/repositories/dataTransfer.ts'
import { buildBackup } from '../../domain/backup/build.ts'
import { suggestedFilename } from '../../domain/backup/format.ts'
import { canonicalize } from '../../domain/backup/format.ts'
import { newId } from '../../domain/events/ids.ts'
import { EVENT_SCHEMA_VERSION } from '../../domain/events/types.ts'
import type { ImportPayload } from '../../domain/events/types.ts'
import type { ImportPlan, PlannedConflict } from '../../domain/merge/plan.ts'
import { buildResolution } from '../../domain/merge/resolve.ts'
import type { ConflictDecision, PendingEvent } from '../../domain/merge/resolve.ts'
import { formatCount, formatInstant, formatMonthDayYear } from '../../domain/time/format.ts'
import { MAX_BACKUP_BYTES } from '../../domain/backup/build.ts'
import type { BackupReadFailure } from '../../domain/backup/build.ts'
import { planImportFile } from './importClient.ts'
import { describeDestination, saveTextFile, supportsFilePicker } from './fileAccess.ts'
import styles from './DataScreen.module.css'

const APP_VERSION = '1.0.0'

type ImportPhase =
  | { phase: 'idle' }
  | { phase: 'working'; fileName: string; label: string }
  | {
      phase: 'preview'
      fileName: string
      plan: ImportPlan
      checksumVerified: boolean
      decisions: Record<string, ConflictDecision>
    }
  | { phase: 'committing'; fileName: string }
  | { phase: 'merged'; summary: MergeSummary }
  | { phase: 'error'; fileName: string; failure: BackupReadFailure }

interface MergeSummary {
  added: number
  duplicates: number
  conflicts: number
  totalEvents: number
  coverage: { earliest: string | null; latest: string | null }
  missingSequences: number
  snapshotId: string | null
}

export function DataScreen(): React.JSX.Element {
  const { settings, today, showToast, device } = useApp()
  const fileInput = useRef<HTMLInputElement>(null)

  const [importState, setImportState] = useState<ImportPhase>({ phase: 'idle' })
  const [exportSheet, setExportSheet] = useState<null | { fileName: string; eventCount: number }>(null)
  const [exported, setExported] = useState<null | { fileName: string; note: string }>(null)
  const [conflictIndex, setConflictIndex] = useState<number | null>(null)
  const [storage, setStorage] = useState<Awaited<ReturnType<typeof readStorageEstimate>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetConfirmation, setResetConfirmation] = useState('')

  useDirtyForm(importState.phase === 'preview' || importState.phase === 'committing')

  const report = useLiveQuery(async () => integrityReport(), [])
  const exportRows = useLiveQuery(async () => listExports(), [])
  const importRows = useLiveQuery(async () => listImports(), [])
  const habitsById = useLiveQuery(async () => {
    const rows = await db().habitViews.toArray()
    return new Map(rows.map((h) => [h.habitId, h]))
  }, [])
  const deviceLabels = useMemo(
    () =>
      new Map((report?.devices ?? []).map((d) => [d.deviceId, d.isThisDevice ? 'This device' : d.label])),
    [report],
  )

  // One asynchronous probe of the storage API, re-run when the event count
  // changes. Persistence is requested only once the user has data worth
  // keeping, and a refusal is perfectly normal.
  const eventCount = report?.eventCount ?? 0
  const [storageEpoch, setStorageEpoch] = useState(0)
  const refreshStorage = useCallback(() => setStorageEpoch((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    const probe = async (): Promise<void> => {
      if (eventCount > 0) await requestPersistentStorage()
      const estimate = await readStorageEstimate()
      if (!cancelled) setStorage(estimate)
    }
    void probe()
    return () => {
      cancelled = true
    }
  }, [eventCount, storageEpoch])

  /* ----------------------------------------------------------- exporting */

  const openExport = async (): Promise<void> => {
    const events = await allEvents()
    setExported(null)
    setExportSheet({ fileName: suggestedFilename(today), eventCount: events.length })
  }

  const runExport = async (): Promise<void> => {
    if (!exportSheet) return
    setBusy(true)
    try {
      const events = await allEvents()
      const backup = await buildBackup({
        events,
        sourceDevice: { deviceId: device?.deviceId ?? 'unknown', label: device?.label ?? 'This device' },
        appVersion: APP_VERSION,
      })
      const outcome = await saveTextFile(exportSheet.fileName, `${canonicalize(backup)}\n`)
      if (outcome.status === 'cancelled') {
        setBusy(false)
        return
      }
      await recordExport({
        exportedAt: new Date().toISOString(),
        fileName: outcome.fileName,
        eventCount: backup.eventCount,
        earliestLocalDate: backup.coverage.earliestLocalDate,
        latestLocalDate: backup.coverage.latestLocalDate,
        destinationNote: describeDestination(outcome),
      })
      setExported({ fileName: outcome.fileName, note: describeDestination(outcome) })
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The export failed.', { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  /* ----------------------------------------------------------- importing */

  const onFileChosen = async (file: File | null): Promise<void> => {
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) {
      setImportState({
        phase: 'error',
        fileName: file.name,
        failure: { kind: 'too-large', message: 'That file is larger than this app will read.' },
      })
      return
    }

    setImportState({ phase: 'working', fileName: file.name, label: 'Reading the file…' })
    try {
      const fileText = await file.text()
      setImportState({ phase: 'working', fileName: file.name, label: 'Comparing with your history…' })
      const localEvents = await allEvents()
      const result = await planImportFile({ fileText, fileName: file.name, localEvents })

      if (!result.ok) {
        setImportState({ phase: 'error', fileName: file.name, failure: result.failure })
        return
      }
      setImportState({
        phase: 'preview',
        fileName: file.name,
        plan: result.plan,
        checksumVerified: result.checksumVerified,
        decisions: {},
      })
    } catch (error) {
      setImportState({
        phase: 'error',
        fileName: file.name,
        failure: {
          kind: 'unreadable',
          message: error instanceof Error ? error.message : 'That file could not be read.',
        },
      })
    }
  }

  const resolveConflict = (conflict: PlannedConflict, decision: ConflictDecision): void => {
    setImportState((state) => {
      if (state.phase !== 'preview') return state
      return { ...state, decisions: { ...state.decisions, [conflict.entityId]: decision } }
    })
    setConflictIndex(null)
  }

  const commit = async (): Promise<void> => {
    if (importState.phase !== 'preview') return
    const { plan, fileName, decisions } = importState
    setImportState({ phase: 'committing', fileName })

    try {
      // A pre-merge snapshot exists before a single row is written.
      const snapshot = await createSnapshot('pre-merge')

      const localDrafts: PendingEvent[] = []
      for (const conflict of plan.conflicts) {
        const decision = decisions[conflict.entityId]
        if (!decision) continue
        const built = buildResolution(conflict, decision)
        localDrafts.push(built.resolution as PendingEvent)
        if (built.split) localDrafts.push(built.split as PendingEvent)
      }

      const importId = newId()
      const auditPayload: ImportPayload = {
        importId,
        backupId: plan.backupId,
        sourceDeviceId: plan.sourceDevice.deviceId,
        sourceDeviceLabel: plan.sourceDevice.label,
        newEventCount: plan.newEventCount,
        alreadyPresentCount: plan.alreadyPresentCount,
        conflictCount: plan.conflictCount,
      }
      localDrafts.push({
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId: newId(),
        entityId: importId,
        entityType: 'system',
        eventType: 'system.imported',
        parentEventIds: [],
        occurredLocalDate: today,
        timezoneId: settings.timezoneId,
        payload: auditPayload,
      })

      await commitImport({
        importedEvents: plan.newEvents,
        localDrafts,
        importRow: {
          importId,
          backupId: plan.backupId,
          importedAt: new Date().toISOString(),
          sourceDeviceId: plan.sourceDevice.deviceId,
          sourceDeviceLabel: plan.sourceDevice.label,
          fileName,
          newEventCount: plan.newEventCount,
          alreadyPresentCount: plan.alreadyPresentCount,
          conflictCount: plan.conflictCount,
          snapshotId: snapshot.snapshotId,
          rolledBackAt: null,
        },
      })

      const after = await integrityReport()
      setImportState({
        phase: 'merged',
        summary: {
          added: plan.newEventCount,
          duplicates: plan.alreadyPresentCount,
          conflicts: plan.conflictCount,
          totalEvents: after.eventCount,
          coverage: {
            earliest: after.coverage.earliestLocalDate,
            latest: after.coverage.latestLocalDate,
          },
          missingSequences: after.missingSequenceCount,
          snapshotId: snapshot.snapshotId,
        },
      })
      void refreshStorage()
    } catch (error) {
      setImportState({
        phase: 'error',
        fileName,
        failure: {
          kind: 'validation',
          message:
            error instanceof Error
              ? error.message
              : 'The merge failed. Nothing was written — your database is unchanged.',
          issues: [],
        },
      })
    }
  }

  const rollback = async (): Promise<void> => {
    const snapshotId =
      (importState.phase === 'merged' ? importState.summary.snapshotId : null) ??
      (await latestSnapshotId())
    if (!snapshotId) {
      showToast('There is no snapshot to restore.', { tone: 'bad' })
      return
    }
    setBusy(true)
    try {
      await restoreSnapshot(snapshotId)
      const after = await integrityReport()
      setImportState({ phase: 'idle' })
      showToast(`Pre-merge snapshot restored · ${formatCount(after.eventCount)} events`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The rollback failed.', { tone: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  const resetEverything = async (): Promise<void> => {
    setBusy(true)
    try {
      await deleteAllLocalData()
      // A full reload is the honest way back to a clean slate: it rebuilds the
      // device identity, the settings and every open live query from nothing.
      window.location.replace(`${import.meta.env.BASE_URL}#/`)
      window.location.reload()
    } catch (error) {
      setBusy(false)
      showToast(error instanceof Error ? error.message : 'The data could not be deleted.', {
        tone: 'bad',
      })
    }
  }

  /* --------------------------------------------------------------- view */

  const activeConflict =
    importState.phase === 'preview' && conflictIndex !== null
      ? (importState.plan.conflicts[conflictIndex] ?? null)
      : null
  const activeConflictHabit = activeConflict
    ? (habitsById?.get(activeConflict.habitId ?? '') ?? null)
    : null

  const unresolved =
    importState.phase === 'preview'
      ? importState.plan.conflicts.filter((c) => !importState.decisions[c.entityId])
      : []

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Data</h1>
          <p className={styles.subtitle}>Local-first storage and portable backups.</p>
        </div>
      </div>

      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className="card" aria-label="This device">
            <h2 className={styles.cardTitle}>This device</h2>
            <div className={styles.deviceName}>{device?.label ?? 'This device'}</div>
            <div className={styles.bigCount}>
              <span className={`${styles.bigCountValue} num`}>
                {formatCount(report?.eventCount ?? 0)}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--ink2)' }}>events</span>
            </div>

            <div className={styles.factRow}>
              <span className={styles.factLabel}>Coverage</span>
              <span className="num">
                {report?.coverage.earliestLocalDate
                  ? `${formatMonthDayYear(report.coverage.earliestLocalDate)} – ${formatMonthDayYear(
                      report.coverage.latestLocalDate ?? report.coverage.earliestLocalDate,
                    )}`
                  : 'Nothing recorded yet'}
              </span>
            </div>
            <div className={styles.factRow}>
              <span className={styles.factLabel}>Latest</span>
              <span className="num">
                {report?.latestRecordedAt
                  ? formatInstant(report.latestRecordedAt, settings.timezoneId)
                  : '—'}
              </span>
            </div>
            <div className={styles.factRow}>
              <span className={styles.factLabel}>Integrity</span>
              {report && report.missingSequenceCount > 0 ? (
                <span className={styles.integrityWarn}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  {report.missingSequenceCount} missing sequence
                  {report.missingSequenceCount === 1 ? '' : 's'}
                </span>
              ) : (
                <span className={styles.integrityGood}>
                  <span className={styles.statusDot} aria-hidden="true" />
                  No sequence gaps
                </span>
              )}
            </div>

            <p className={styles.hint}>
              Coverage is the earliest and latest occurrence represented in the event log.
            </p>

            <div className={styles.buttonRow}>
              <button type="button" className="btnPrimary" onClick={() => void openExport()}>
                Export backup
              </button>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => fileInput.current?.click()}
              >
                Import backup
              </button>
            </div>
            <input
              ref={fileInput}
              className={styles.visuallyHiddenInput}
              type="file"
              accept="application/json,.json"
              aria-label="Choose a backup file"
              onChange={(e) => {
                void onFileChosen(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </section>

          <section className="card" aria-label="Browser storage">
            <h2 className={styles.cardTitle}>Browser storage</h2>
            <div className={styles.factRow}>
              <span className={styles.factLabel}>Used</span>
              <span className="num">
                {storage?.supported
                  ? `${formatBytes(storage.usageBytes)} of ${formatBytes(storage.quotaBytes)}`
                  : 'This browser does not report an estimate'}
              </span>
            </div>
            <div className={styles.factRow}>
              <span className={styles.factLabel}>Persistence</span>
              <span>
                {storage?.persisted
                  ? 'Granted — the browser has agreed to keep this data'
                  : 'Not granted — this is common and normal'}
              </span>
            </div>
            <p className={styles.hint}>
              Browser storage is not a backup. Clearing site data removes everything here, so export
              a file whenever it would hurt to lose what you have logged.
            </p>
          </section>

          <section className="card" aria-label="Backup history">
            <h2 className={styles.cardTitle}>Backup history</h2>
            {exportRows?.length ? (
              <div className={styles.tableScroll}>
                <div className={styles.table}>
                  <div className={styles.tableHead}>
                    <span>Date</span>
                    <span>Events</span>
                    <span>Range</span>
                    <span>Source</span>
                    <span>Location</span>
                  </div>
                  {exportRows.map((row) => (
                    <div className={`${styles.tableRow} num`} key={row.exportId}>
                      <span>{formatInstant(row.exportedAt, settings.timezoneId).split(' · ')[0]}</span>
                      <span>{formatCount(row.eventCount)}</span>
                      <span className={styles.muted}>
                        {row.earliestLocalDate
                          ? `${row.earliestLocalDate} – ${row.latestLocalDate ?? row.earliestLocalDate}`
                          : '—'}
                      </span>
                      <span className={styles.muted}>This device</span>
                      <span className={styles.pathCell}>{row.fileName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className={styles.hint}>
                No exports yet. An export records its date, event count and coverage here.
              </p>
            )}
          </section>

          <section className="card" aria-label="Start over">
            <h2 className={styles.cardTitle}>Start over</h2>
            <p className={styles.hint} style={{ marginTop: 0 }}>
              Deletes every habit, entry and goal stored in this browser and returns the app to its
              first-run state. Useful before restoring a backup from another device, and while you
              are still trying things out.
            </p>
            <p className={styles.hint}>
              This cannot be undone, and it does not touch backup files you have already saved.
            </p>
            <div className={styles.buttonRow}>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => void openExport()}
                disabled={busy}
              >
                Export a backup first
              </button>
              <button
                type="button"
                className="btnDanger"
                onClick={() => {
                  setResetConfirmation('')
                  setResetOpen(true)
                }}
                disabled={busy}
              >
                Delete all data
              </button>
            </div>
          </section>

          {importRows?.length ? (
            <section className="card" aria-label="Import history">
              <h2 className={styles.cardTitle}>Import history</h2>
              {importRows.map((row) => (
                <div className={styles.mergeRow} key={row.importId}>
                  <span className={styles.mergeLabel}>
                    {formatInstant(row.importedAt, settings.timezoneId)} · {row.sourceDeviceLabel}
                    {row.rolledBackAt ? ' · rolled back' : ''}
                  </span>
                  <span className={`${styles.mergeValue} num`}>
                    +{formatCount(row.newEventCount)}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
        </div>

        <section className="card" aria-label="Import preview">
          <h2 className={styles.cardTitle}>Import preview</h2>

          {importState.phase === 'idle' ? (
            <div className={styles.importEmpty}>
              <p className={styles.importEmptyText}>
                Choose a backup file to see exactly what a merge would add before anything is
                written.
              </p>
              <button
                type="button"
                className="btnSecondary"
                onClick={() => fileInput.current?.click()}
              >
                Choose file…
              </button>
            </div>
          ) : null}

          {importState.phase === 'working' || importState.phase === 'committing' ? (
            <p className={styles.hint} role="status">
              {importState.phase === 'committing'
                ? 'Merging… nothing is final until this finishes.'
                : importState.label}
            </p>
          ) : null}

          {importState.phase === 'error' ? (
            <>
              <p className="noticeBad" role="alert">
                <span className="badge" aria-hidden="true">
                  !
                </span>
                <span>{importState.failure.message}</span>
              </p>
              {'issues' in importState.failure && importState.failure.issues.length ? (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ fontSize: 12.5, color: 'var(--ink2)', cursor: 'pointer' }}>
                    Technical detail
                  </summary>
                  <ul className={styles.pathCell} style={{ marginTop: 8 }}>
                    {importState.failure.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className={styles.hint}>Your database was not changed.</p>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className="btnSecondary"
                  onClick={() => setImportState({ phase: 'idle' })}
                >
                  Start over
                </button>
              </div>
            </>
          ) : null}

          {importState.phase === 'preview' ? (
            <>
              <div className={styles.fileName}>{importState.fileName}</div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Source</span>
                <span>{importState.plan.sourceDevice.label}</span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Exported</span>
                <span className="num">
                  {formatInstant(importState.plan.exportedAt, settings.timezoneId)}
                </span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Coverage</span>
                <span className="num">
                  {importState.plan.coverageAfter.earliest
                    ? `${importState.plan.coverageAfter.earliest} – ${importState.plan.coverageAfter.latest}`
                    : '—'}
                </span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Schema</span>
                <span className="mono" style={{ fontSize: 12.5 }}>
                  v{importState.plan.formatVersion} ·{' '}
                  {importState.checksumVerified ? 'checksum verified' : 'no checksum present'}
                </span>
              </div>

              <div className={styles.counts}>
                <div className={styles.count}>
                  <div className={`${styles.countValue} num`}>
                    {formatCount(importState.plan.alreadyPresentCount)}
                  </div>
                  <div className={styles.countLabel}>Already present</div>
                </div>
                <div className={styles.count}>
                  <div
                    className={`${styles.countValue} num`}
                    style={{ color: 'var(--grnInk)' }}
                  >
                    {formatCount(importState.plan.newEventCount)}
                  </div>
                  <div className={styles.countLabel}>New events</div>
                </div>
                <div className={styles.count}>
                  <div
                    className={`${styles.countValue} num`}
                    style={{ color: unresolved.length ? 'var(--ambInk)' : undefined }}
                  >
                    {unresolved.length}
                  </div>
                  <div className={styles.countLabel}>
                    {unresolved.length === 1 ? 'Conflict' : 'Conflicts left'}
                  </div>
                </div>
                <div className={styles.count}>
                  <div className={`${styles.countValue} num`}>
                    {importState.plan.missingSequenceCount}
                  </div>
                  <div className={styles.countLabel}>Missing sequences</div>
                </div>
              </div>

              <p className="noticeGood" style={{ marginTop: 18 }}>
                <span className="badge" aria-hidden="true">
                  ✓
                </span>
                <span style={{ fontWeight: 500 }}>Nothing will be overwritten</span>
              </p>
              <p className={styles.hint}>
                Merge adds immutable events by ID. A pre-merge snapshot is created automatically
                before anything is written.
              </p>

              {importState.plan.conflicts.length ? (
                <div className={styles.conflictQueue}>
                  {importState.plan.conflicts.map((conflict, index) => {
                    const resolved = Boolean(importState.decisions[conflict.entityId])
                    return (
                      <button
                        type="button"
                        key={conflict.entityId}
                        className={`${styles.conflictItem} ${resolved ? styles.conflictResolved : ''}`}
                        onClick={() => setConflictIndex(index)}
                      >
                        <span aria-hidden="true">{resolved ? '✓' : '!'}</span>
                        <span style={{ flex: 1 }}>
                          {habitsById?.get(conflict.habitId ?? '')?.displayName ?? 'An entry'} ·{' '}
                          {conflict.heads.length} versions
                        </span>
                        <span>{resolved ? 'Resolved' : 'Review'}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}

              {importState.plan.newEventCount === 0 && importState.plan.conflictCount === 0 ? (
                <p className="noticeGood" style={{ marginTop: 12 }}>
                  <span className="badge" aria-hidden="true">
                    ✓
                  </span>
                  <span>This backup is already fully present. Merging it changes nothing.</span>
                </p>
              ) : null}

              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className="btnSecondary"
                  onClick={() => setImportState({ phase: 'idle' })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btnPrimary"
                  disabled={unresolved.length > 0}
                  onClick={() => void commit()}
                >
                  {unresolved.length
                    ? `Resolve ${unresolved.length} conflict${unresolved.length === 1 ? '' : 's'} first`
                    : `Merge ${formatCount(importState.plan.newEventCount)} events`}
                </button>
              </div>
            </>
          ) : null}

          {importState.phase === 'merged' ? (
            <>
              <p className="noticeGood">
                <span className="badge" aria-hidden="true">
                  ✓
                </span>
                <span style={{ fontWeight: 600 }}>Merge complete</span>
              </p>
              <div style={{ marginTop: 16 }}>
                <MergeRow label="New events added" value={formatCount(importState.summary.added)} tone="var(--grnInk)" />
                <MergeRow label="Duplicates ignored" value={formatCount(importState.summary.duplicates)} />
                <MergeRow label="Conflicts resolved" value={String(importState.summary.conflicts)} />
                <MergeRow label="New total events" value={formatCount(importState.summary.totalEvents)} />
                <MergeRow
                  label="New coverage"
                  value={
                    importState.summary.coverage.earliest
                      ? `${importState.summary.coverage.earliest} – ${importState.summary.coverage.latest}`
                      : '—'
                  }
                />
                <MergeRow
                  label="Sequence gaps remaining"
                  value={importState.summary.missingSequences === 0 ? 'None' : String(importState.summary.missingSequences)}
                  tone={importState.summary.missingSequences === 0 ? 'var(--grnInk)' : 'var(--ambInk)'}
                />
              </div>
              <p className={styles.hint}>
                A pre-merge snapshot was created before anything was written. Restoring it replaces
                the event set — it is not itself recorded as a habit event.
              </p>
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className="btnDanger"
                  onClick={() => void rollback()}
                  disabled={busy}
                >
                  Restore snapshot
                </button>
                <button
                  type="button"
                  className="btnPrimary"
                  onClick={() => setImportState({ phase: 'idle' })}
                >
                  Done
                </button>
              </div>
            </>
          ) : null}
        </section>
      </div>

      {/* Export */}
      <Sheet
        open={exportSheet !== null}
        title="Export backup"
        onClose={() => {
          setExportSheet(null)
          setExported(null)
        }}
      >
        {exported ? (
          <>
            <p className="noticeGood">
              <span className="badge" aria-hidden="true">
                ✓
              </span>
              <span style={{ fontWeight: 600 }}>Backup saved</span>
            </p>
            <p className={`${styles.fileNameMono}`} style={{ marginTop: 14 }}>
              {exported.fileName}
            </p>
            <p style={{ fontSize: 13.5, color: 'var(--ink2)', marginTop: 8 }}>{exported.note}</p>
            <p className={styles.hint}>Recorded in backup history on this device.</p>
            <button
              type="button"
              className="btnSecondary"
              style={{ width: '100%', marginTop: 18 }}
              onClick={() => {
                setExportSheet(null)
                setExported(null)
              }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--ink2)', margin: 0 }}>
              A complete, versioned JSON backup of every event on this device.
              {supportsFilePicker()
                ? ' Choose where to save it — iCloud Drive, a folder, anywhere.'
                : ' It will go to your browser’s downloads, where you can move it anywhere.'}
            </p>
            <div className={styles.exportSummary}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Suggested filename
              </div>
              <div className={styles.fileNameMono}>{exportSheet?.fileName}</div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Events</span>
                <span className="num">{formatCount(exportSheet?.eventCount ?? 0)}</span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Coverage</span>
                <span className="num">
                  {report?.coverage.earliestLocalDate
                    ? `${report.coverage.earliestLocalDate} – ${report.coverage.latestLocalDate}`
                    : '—'}
                </span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factLabel}>Format</span>
                <span className="mono" style={{ fontSize: 12.5 }}>
                  habit-tracker-backup v1 · plain JSON
                </span>
              </div>
            </div>
            <p className={styles.hint}>
              This file is readable text: it contains your timestamps, values and notes. Exporting is
              not cloud synchronization — nothing leaves this device until you choose a location.
            </p>
            <div className={styles.buttonRow}>
              <button type="button" className="btnSecondary" onClick={() => setExportSheet(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btnPrimary"
                disabled={busy}
                onClick={() => void runExport()}
              >
                {busy ? 'Saving…' : supportsFilePicker() ? 'Choose location…' : 'Download backup'}
              </button>
            </div>
          </>
        )}
      </Sheet>

      {/* Start over */}
      <Sheet
        open={resetOpen}
        title="Delete all data"
        onClose={() => setResetOpen(false)}
        description="This removes everything this browser has stored for the app and cannot be undone."
      >
        <div className={styles.exportSummary}>
          <div className={styles.factRow}>
            <span className={styles.factLabel}>Events</span>
            <span className="num">{formatCount(report?.eventCount ?? 0)}</span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.factLabel}>Habits</span>
            <span className="num">{formatCount(habitsById?.size ?? 0)}</span>
          </div>
          <div className={styles.factRow}>
            <span className={styles.factLabel}>Coverage</span>
            <span className="num">
              {report?.coverage.earliestLocalDate
                ? `${report.coverage.earliestLocalDate} – ${report.coverage.latestLocalDate}`
                : 'Nothing recorded yet'}
            </span>
          </div>
        </div>

        <p className={styles.hint}>
          Backup files you have already saved are untouched, and you can import one afterwards.
        </p>

        <div style={{ marginTop: 16 }}>
          <label className="fieldLabel" htmlFor="reset-confirm">
            Type <strong>delete</strong> to confirm
          </label>
          <input
            id="reset-confirm"
            className="field"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={resetConfirmation}
            onChange={(e) => setResetConfirmation(e.target.value)}
          />
        </div>

        <div className={styles.buttonRow}>
          <button type="button" className="btnSecondary" onClick={() => setResetOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btnDanger"
            disabled={busy || resetConfirmation.trim().toLowerCase() !== 'delete'}
            onClick={() => void resetEverything()}
          >
            {busy ? 'Deleting…' : 'Delete everything'}
          </button>
        </div>
      </Sheet>

      {/* Conflicts */}
      <ConflictResolver
        open={conflictIndex !== null && importState.phase === 'preview'}
        conflict={activeConflict}
        index={conflictIndex ?? 0}
        total={importState.phase === 'preview' ? importState.plan.conflicts.length : 0}
        habitLabel={activeConflictHabit?.displayName ?? 'Entry'}
        model={activeConflictHabit?.trackingModel ?? 'duration'}
        timezoneId={settings.timezoneId}
        deviceLabels={deviceLabels}
        onResolve={(decision) => {
          if (importState.phase !== 'preview' || conflictIndex === null) return
          const conflict = importState.plan.conflicts[conflictIndex]
          if (conflict) resolveConflict(conflict, decision)
        }}
        onClose={() => setConflictIndex(null)}
      />
    </div>
  )
}

function MergeRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: string
}): React.JSX.Element {
  return (
    <div className={styles.mergeRow}>
      <span className={styles.mergeLabel}>{label}</span>
      <span className={`${styles.mergeValue} num`} style={tone ? { color: tone } : undefined}>
        {value}
      </span>
    </div>
  )
}
