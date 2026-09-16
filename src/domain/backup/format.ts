/**
 * The portable backup format and its canonical serialization.
 *
 * The checksum detects accidental corruption — a truncated download, a text
 * editor that mangled the file. It is *not* an authenticity guarantee: anyone
 * who edits the file can recompute it. See docs/backup-format.md.
 */

import { z } from 'zod'
import type { DomainEvent } from '../events/types.ts'
import { domainEventEnvelopeSchema } from '../events/schema.ts'
import { localDateSchema, instantSchema, uuidSchema } from '../events/schema.ts'

export const BACKUP_FORMAT = 'habit-tracker-backup' as const
export const BACKUP_FORMAT_VERSION = 1 as const
/** Backup formats this build can read. Anything newer fails safely. */
export const SUPPORTED_FORMAT_VERSIONS = [1] as const

export interface BackupChecksum {
  algorithm: 'SHA-256'
  value: string
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  backupId: string
  exportedAt: string
  appVersion: string
  sourceDevice: { deviceId: string; label: string }
  coverage: {
    earliestLocalDate: string | null
    latestLocalDate: string | null
    latestRecordedAt: string | null
  }
  highWaterMarks: Record<string, number>
  eventCount: number
  events: DomainEvent[]
  checksum?: BackupChecksum
}

export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number().int().min(1),
  backupId: uuidSchema,
  exportedAt: instantSchema,
  appVersion: z.string().max(32),
  sourceDevice: z.object({ deviceId: uuidSchema, label: z.string().max(80) }),
  coverage: z.object({
    earliestLocalDate: localDateSchema.nullable(),
    latestLocalDate: localDateSchema.nullable(),
    latestRecordedAt: instantSchema.nullable(),
  }),
  highWaterMarks: z.record(uuidSchema, z.number().int().min(0)),
  eventCount: z.number().int().min(0),
  events: z.array(z.unknown()).max(1_000_000),
  checksum: z
    .object({ algorithm: z.literal('SHA-256'), value: z.string().min(16).max(128) })
    .optional(),
})

/* --------------------------------------------------------- canonical form */

/**
 * Canonical JSON, version 1.
 *
 * 1. Object keys are sorted by UTF-16 code unit, ascending.
 * 2. Keys whose value is `undefined` are dropped entirely.
 * 3. Arrays keep their order.
 * 4. No insignificant whitespace.
 * 5. Strings and numbers use `JSON.stringify`'s own escaping; non-finite
 *    numbers are rejected rather than becoming `null`.
 *
 * The exact byte sequence this produces is what the checksum covers, so the
 * rules above are frozen for formatVersion 1.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new RangeError('Canonical JSON cannot represent a non-finite number')
    }
    return JSON.stringify(value)
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`
  }
  if (t === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
  }
  throw new TypeError(`Canonical JSON cannot represent ${t}`)
}

/** The exact bytes a checksum is computed over: the backup minus `checksum`. */
export function checksumPayload(backup: BackupFile): string {
  const { checksum: _omit, ...rest } = backup
  void _omit
  return canonicalize(rest)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function computeChecksum(backup: BackupFile): Promise<BackupChecksum> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto is unavailable, so a backup checksum cannot be computed.')
  }
  const data = new TextEncoder().encode(checksumPayload(backup))
  const digest = await subtle.digest('SHA-256', data as BufferSource)
  return { algorithm: 'SHA-256', value: base64Url(new Uint8Array(digest)) }
}

export async function verifyChecksum(backup: BackupFile): Promise<boolean> {
  if (!backup.checksum) return true
  const expected = await computeChecksum(backup)
  return expected.value === backup.checksum.value
}

/* ------------------------------------------------------------ event order */

/**
 * Deterministic export order, so two exports of the same log are byte-identical
 * and diffable. Sorted by recordedAt, then device, sequence, and id.
 */
export function canonicalEventOrder(events: readonly DomainEvent[]): DomainEvent[] {
  return [...events].sort((a, b) => {
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1
    if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
    if (a.deviceSequence !== b.deviceSequence) return a.deviceSequence - b.deviceSequence
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
  })
}

/**
 * Strips keys the envelope does not define, so a file written by a future build
 * cannot smuggle extra fields through and change a checksum after a round trip.
 */
export function normalizeEvent(event: DomainEvent): DomainEvent {
  const allowed = Object.keys(domainEventEnvelopeSchema.shape) as (keyof DomainEvent)[]
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    const value = event[key]
    if (value !== undefined) out[key] = value
  }
  return out as unknown as DomainEvent
}

/** Suggested filename. Deliberately generic: it never names a habit. */
export function suggestedFilename(localDate: string): string {
  return `habit-backup-${localDate}.json`
}
