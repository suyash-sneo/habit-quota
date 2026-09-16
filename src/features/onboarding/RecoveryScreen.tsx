/**
 * Shown when the database will not open or the UI crashed.
 *
 * Retrying is the primary action. Clearing data is deliberately last, plainly
 * labelled as destructive, and never presented as the fix.
 */

import { useState } from 'react'
import { db } from '../../db/database.ts'
import { allEvents } from '../../db/repositories/dataTransfer.ts'
import { buildBackup } from '../../domain/backup/build.ts'
import { canonicalize, suggestedFilename } from '../../domain/backup/format.ts'
import { saveTextFile } from '../data-transfer/fileAccess.ts'
import styles from './RecoveryScreen.module.css'

export interface RecoveryScreenProps {
  title: string
  error: Error
  onRetry: () => void
}

/** A short, non-sensitive code the user can quote. Contains no habit data. */
function diagnosticCode(error: Error): string {
  const name = error.name || 'Error'
  const digest = [...(error.message || '')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
  return `${name}-${digest.toString(16).slice(0, 6)}`
}

export function RecoveryScreen({ title, error, onRetry }: RecoveryScreenProps): React.JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const rescueExport = async (): Promise<void> => {
    setBusy(true)
    setStatus(null)
    try {
      const events = await allEvents()
      const backup = await buildBackup({
        events,
        sourceDevice: { deviceId: 'recovery', label: 'This device' },
        appVersion: '1.0.0',
      })
      const name = suggestedFilename(new Date().toISOString().slice(0, 10))
      const outcome = await saveTextFile(name, `${canonicalize(backup)}\n`)
      setStatus(
        outcome.status === 'cancelled'
          ? 'Export cancelled.'
          : `Exported ${events.length} events to ${outcome.fileName}.`,
      )
    } catch (caught) {
      setStatus(
        caught instanceof Error
          ? `Export failed: ${caught.message}`
          : 'Export failed for an unknown reason.',
      )
    } finally {
      setBusy(false)
    }
  }

  const clearEverything = async (): Promise<void> => {
    const confirmed = window.confirm(
      'This permanently deletes every habit and entry stored in this browser. ' +
        'It cannot be undone, and it does not touch backup files you have already saved.\n\n' +
        'Delete all local data?',
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await db().delete()
      window.location.reload()
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : 'The database could not be deleted.')
      setBusy(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>
          Your habits are stored in this browser’s database. Nothing has been deleted — this screen
          appears when the app could not read it just now.
        </p>

        <div className={styles.actions}>
          <button type="button" className="btnPrimary" onClick={onRetry} disabled={busy}>
            Try again
          </button>
          <button type="button" className="btnSecondary" onClick={() => void rescueExport()} disabled={busy}>
            Export what can be read
          </button>
        </div>

        {status ? (
          <p className={styles.status} role="status">
            {status}
          </p>
        ) : null}

        <details className={styles.details}>
          <summary>Technical detail</summary>
          <p className={styles.code}>Diagnostic code: {diagnosticCode(error)}</p>
          <p className={styles.code}>{error.message}</p>
          <p className={styles.note}>
            Nothing is sent anywhere. This code is only here so you can write it down.
          </p>
        </details>

        <div className={styles.destructive}>
          <h2 className={styles.destructiveTitle}>Last resort</h2>
          <p className={styles.note}>
            Deleting the local database permanently removes every habit and entry in this browser. Do
            this only after exporting, or if you are certain you do not need the data.
          </p>
          <button type="button" className="btnDanger" onClick={() => void clearEverything()} disabled={busy}>
            Delete all local data
          </button>
        </div>
      </div>
    </main>
  )
}
