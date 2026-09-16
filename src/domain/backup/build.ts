/**
 * Building an export and reading one back.
 *
 * Both directions are pure: they take and return plain data, so the same code
 * runs in the UI thread, in the import worker, and in tests.
 */

import type { DomainEvent } from '../events/types.ts'
import { newId } from '../events/ids.ts'
import { validateDomainEvent } from '../events/schema.ts'
import type { BackupFile } from './format.ts'
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  SUPPORTED_FORMAT_VERSIONS,
  backupEnvelopeSchema,
  canonicalEventOrder,
  canonicalize,
  computeChecksum,
  normalizeEvent,
  verifyChecksum,
} from './format.ts'

export interface BuildBackupOptions {
  events: readonly DomainEvent[]
  sourceDevice: { deviceId: string; label: string }
  appVersion: string
  exportedAt?: string
  backupId?: string
}

export function highWaterMarksOf(events: readonly DomainEvent[]): Record<string, number> {
  const marks: Record<string, number> = {}
  for (const event of events) {
    const current = marks[event.deviceId]
    if (current === undefined || event.deviceSequence > current) {
      marks[event.deviceId] = event.deviceSequence
    }
  }
  return marks
}

export function coverageOf(events: readonly DomainEvent[]): BackupFile['coverage'] {
  let earliest: string | null = null
  let latest: string | null = null
  let latestRecordedAt: string | null = null
  for (const event of events) {
    const date = event.occurredLocalDate
    if (date) {
      if (earliest === null || date < earliest) earliest = date
      if (latest === null || date > latest) latest = date
    }
    if (latestRecordedAt === null || event.recordedAt > latestRecordedAt) {
      latestRecordedAt = event.recordedAt
    }
  }
  return { earliestLocalDate: earliest, latestLocalDate: latest, latestRecordedAt }
}

export async function buildBackup({
  events,
  sourceDevice,
  appVersion,
  exportedAt = new Date().toISOString(),
  backupId = newId(),
}: BuildBackupOptions): Promise<BackupFile> {
  const ordered = canonicalEventOrder(events).map(normalizeEvent)
  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId,
    exportedAt,
    appVersion,
    sourceDevice,
    coverage: coverageOf(ordered),
    highWaterMarks: highWaterMarksOf(ordered),
    eventCount: ordered.length,
    events: ordered,
  }
  backup.checksum = await computeChecksum(backup)
  return backup
}

/* ------------------------------------------------------------------ read */

export type BackupReadFailure =
  | { kind: 'unreadable'; message: string }
  | { kind: 'wrong-format'; message: string }
  | { kind: 'unsupported-version'; message: string; formatVersion: number }
  | { kind: 'checksum-mismatch'; message: string }
  | { kind: 'validation'; message: string; issues: string[] }
  | { kind: 'too-large'; message: string }

export type BackupReadResult =
  | { ok: true; backup: BackupFile; checksumVerified: boolean }
  | { ok: false; failure: BackupReadFailure }

/** Refuse anything implausibly large before parsing it. 64 MB of JSON is ample. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024

/** How many individual validation issues to surface; the rest are counted. */
const MAX_REPORTED_ISSUES = 20

export async function readBackup(text: string): Promise<BackupReadResult> {
  if (text.length > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      failure: {
        kind: 'too-large',
        message: 'That file is larger than this app will read.',
      },
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {
      ok: false,
      failure: { kind: 'unreadable', message: 'That file is not valid JSON.' },
    }
  }

  const envelope = backupEnvelopeSchema.safeParse(parsed)
  if (!envelope.success) {
    const looksLikeBackup =
      typeof parsed === 'object' && parsed !== null && 'format' in parsed
    if (
      looksLikeBackup &&
      typeof (parsed as { formatVersion?: unknown }).formatVersion === 'number' &&
      !SUPPORTED_FORMAT_VERSIONS.includes(
        (parsed as { formatVersion: number }).formatVersion as 1,
      )
    ) {
      return {
        ok: false,
        failure: {
          kind: 'unsupported-version',
          formatVersion: (parsed as { formatVersion: number }).formatVersion,
          message: 'This backup was created by a newer app version.',
        },
      }
    }
    return {
      ok: false,
      failure: {
        kind: 'wrong-format',
        message: 'That file is not a habit tracker backup.',
      },
    }
  }

  if (!SUPPORTED_FORMAT_VERSIONS.includes(envelope.data.formatVersion as 1)) {
    return {
      ok: false,
      failure: {
        kind: 'unsupported-version',
        formatVersion: envelope.data.formatVersion,
        message: 'This backup was created by a newer app version.',
      },
    }
  }

  const events: DomainEvent[] = []
  const issues: string[] = []
  let extraIssues = 0
  const seen = new Map<string, string>()

  for (let i = 0; i < envelope.data.events.length; i += 1) {
    const result = validateDomainEvent(envelope.data.events[i])
    if (!result.ok) {
      for (const issue of result.issues) {
        if (issues.length < MAX_REPORTED_ISSUES) issues.push(`event ${i}: ${issue}`)
        else extraIssues += 1
      }
      continue
    }
    const event = result.value as DomainEvent
    // Two events with the same id but different content mean the file is
    // corrupt or hand-edited. Merging it would silently rewrite history.
    const fingerprint = canonicalize(normalizeEvent(event))
    const previous = seen.get(event.eventId)
    if (previous !== undefined) {
      if (previous !== fingerprint) {
        return {
          ok: false,
          failure: {
            kind: 'validation',
            message:
              'This file contains two different versions of the same event. It cannot be merged safely.',
            issues: [`duplicate eventId with differing content: ${event.eventId}`],
          },
        }
      }
      continue
    }
    seen.set(event.eventId, fingerprint)
    events.push(event)
  }

  if (issues.length) {
    return {
      ok: false,
      failure: {
        kind: 'validation',
        message: 'Some events in that file did not pass validation.',
        issues: extraIssues ? [...issues, `…and ${extraIssues} more`] : issues,
      },
    }
  }

  const backup: BackupFile = { ...(envelope.data as unknown as BackupFile), events }
  const checksumVerified = await verifyChecksum(backup)
  if (backup.checksum && !checksumVerified) {
    return {
      ok: false,
      failure: {
        kind: 'checksum-mismatch',
        message: 'That file’s checksum does not match its contents, so it may be damaged.',
      },
    }
  }

  return { ok: true, backup, checksumVerified: Boolean(backup.checksum) }
}
