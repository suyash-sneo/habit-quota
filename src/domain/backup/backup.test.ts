import { beforeEach, describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  canonicalEventOrder,
  canonicalize,
  checksumPayload,
  computeChecksum,
  normalizeEvent,
  suggestedFilename,
  verifyChecksum,
} from './format.ts'
import type { BackupFile } from './format.ts'
import { buildBackup, coverageOf, highWaterMarksOf, readBackup } from './build.ts'
import {
  DEVICE_A,
  DEVICE_B,
  entryEvent,
  entrySnapshot,
  resetTestIds,
} from '../../test/fixtures/events.ts'

beforeEach(resetTestIds)

const SOURCE = { deviceId: DEVICE_A, label: 'This device' }

// Fixed identifiers, so two builds of "the same log" really are the same log
// and the checksum vectors below are reproducible.
const EVENT_ONE = 'e1111111-1111-4111-8111-111111111111'
const EVENT_TWO = 'e2222222-2222-4222-8222-222222222222'
const ENTRY_ONE = 'a1111111-1111-4111-8111-111111111111'
const ENTRY_TWO = 'a2222222-2222-4222-8222-222222222222'

async function sampleBackup(): Promise<BackupFile> {
  return buildBackup({
    events: [
      entryEvent(
        'entry.created',
        entrySnapshot({ entryId: ENTRY_ONE, occurredLocalDate: '2026-09-15', value: 30 }),
        { eventId: EVENT_ONE, sequence: 1, recordedAt: '2026-09-15T18:42:00.000Z' },
      ),
      entryEvent(
        'entry.created',
        entrySnapshot({ entryId: ENTRY_TWO, occurredLocalDate: '2026-09-16', value: 25 }),
        { eventId: EVENT_TWO, sequence: 2, recordedAt: '2026-09-16T18:42:00.000Z' },
      ),
    ],
    sourceDevice: SOURCE,
    appVersion: '1.0.0',
    exportedAt: '2026-09-16T20:40:00.000Z',
    backupId: 'b0000000-0000-4000-8000-000000000001',
  })
}

describe('canonical JSON', () => {
  it('sorts object keys and drops undefined', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}')
    expect(canonicalize({ z: { y: 1, x: 2 } })).toBe('{"z":{"x":2,"y":1}}')
  })

  it('preserves array order and coerces undefined elements to null', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalize([undefined, 1])).toBe('[null,1]')
  })

  it('matches fixed vectors', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(0)).toBe('0')
    expect(canonicalize(-1.5)).toBe('-1.5')
    expect(canonicalize('a"b')).toBe('"a\\"b"')
    expect(canonicalize('é')).toBe('"é"')
    expect(canonicalize({ '2': 'b', '10': 'a' })).toBe('{"10":"a","2":"b"}')
    expect(
      canonicalize({ format: 'habit-tracker-backup', eventCount: 2, events: [] }),
    ).toBe('{"eventCount":2,"events":[],"format":"habit-tracker-backup"}')
  })

  it('refuses values it cannot represent', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(RangeError)
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => canonicalize(() => 1)).toThrow(TypeError)
  })

  it('is insensitive to key insertion order', () => {
    const a = { format: BACKUP_FORMAT, eventCount: 1 }
    const b = { eventCount: 1, format: BACKUP_FORMAT }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })
})

describe('checksum', () => {
  it('excludes the checksum field from its own input', async () => {
    const backup = await sampleBackup()
    const withChecksum = checksumPayload(backup)
    const withoutChecksum = canonicalize({ ...backup, checksum: undefined })
    expect(withChecksum).toBe(withoutChecksum)
    expect(withChecksum).not.toContain('"checksum"')
  })

  it('verifies an untouched backup', async () => {
    const backup = await sampleBackup()
    await expect(verifyChecksum(backup)).resolves.toBe(true)
  })

  it('detects a changed value', async () => {
    const backup = await sampleBackup()
    const tampered: BackupFile = { ...backup, eventCount: 99 }
    await expect(verifyChecksum(tampered)).resolves.toBe(false)
  })

  it('is stable across two builds of the same log', async () => {
    const first = await sampleBackup()
    const second = await sampleBackup()
    expect(second.checksum?.value).toBe(first.checksum?.value)
  })

  it('produces a base64url digest with no padding', async () => {
    const backup = await sampleBackup()
    expect(backup.checksum?.algorithm).toBe('SHA-256')
    expect(backup.checksum?.value).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('agrees with an independently computed digest', async () => {
    const backup = await sampleBackup()
    const bytes = new TextEncoder().encode(checksumPayload(backup))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(backup.checksum?.value).toBe(expected)
    await expect(computeChecksum(backup)).resolves.toEqual(backup.checksum)
  })
})

describe('backup building', () => {
  it('records coverage and high-water marks', () => {
    const events = [
      entryEvent('entry.created', entrySnapshot({ occurredLocalDate: '2026-01-01' }), { sequence: 4 }),
      entryEvent('entry.created', entrySnapshot({ occurredLocalDate: '2026-09-16' }), {
        sequence: 2,
        deviceId: DEVICE_B,
      }),
    ]
    expect(coverageOf(events).earliestLocalDate).toBe('2026-01-01')
    expect(coverageOf(events).latestLocalDate).toBe('2026-09-16')
    expect(highWaterMarksOf(events)).toEqual({ [DEVICE_A]: 4, [DEVICE_B]: 2 })
  })

  it('orders events deterministically', () => {
    const a = entryEvent('entry.created', entrySnapshot(), {
      eventId: 'a',
      recordedAt: '2026-09-16T10:00:00.000Z',
    })
    const b = entryEvent('entry.created', entrySnapshot(), {
      eventId: 'b',
      recordedAt: '2026-09-16T09:00:00.000Z',
    })
    expect(canonicalEventOrder([a, b]).map((e) => e.eventId)).toEqual(['b', 'a'])
    expect(canonicalEventOrder([b, a]).map((e) => e.eventId)).toEqual(['b', 'a'])
  })

  it('strips unknown fields from an event', () => {
    const event = { ...entryEvent('entry.created', entrySnapshot()), sneaky: 'value' }
    expect(normalizeEvent(event as never)).not.toHaveProperty('sneaky')
  })

  it('suggests a filename that names no habit', () => {
    expect(suggestedFilename('2026-09-16')).toBe('habit-backup-2026-09-16.json')
  })
})

describe('reading a backup', () => {
  it('round-trips an export', async () => {
    const backup = await sampleBackup()
    const result = await readBackup(canonicalize(backup))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.checksumVerified).toBe(true)
      expect(result.backup.events).toHaveLength(2)
      expect(result.backup.events[0]?.eventId).toBe(EVENT_ONE)
    }
  })

  it('rejects text that is not JSON', async () => {
    const result = await readBackup('not json at all')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.kind).toBe('unreadable')
  })

  it('rejects a file that is not a backup', async () => {
    const result = await readBackup(JSON.stringify({ hello: 'world' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.kind).toBe('wrong-format')
  })

  it('fails safely on a newer format version', async () => {
    const backup = await sampleBackup()
    const result = await readBackup(JSON.stringify({ ...backup, formatVersion: 99 }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.kind).toBe('unsupported-version')
      expect(result.failure.message).toContain('newer app version')
    }
  })

  it('detects a corrupted file through its checksum', async () => {
    const backup = await sampleBackup()
    const corrupted = { ...backup, eventCount: 999 }
    const result = await readBackup(JSON.stringify(corrupted))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.kind).toBe('checksum-mismatch')
  })

  it('reports invalid events without mutating anything', async () => {
    const backup = await sampleBackup()
    const broken = {
      ...backup,
      checksum: undefined,
      events: [{ ...backup.events[0], occurredLocalDate: 'yesterday' }],
    }
    const result = await readBackup(JSON.stringify(broken))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.kind).toBe('validation')
      if (result.failure.kind === 'validation') {
        expect(result.failure.issues.join(' ')).toContain('occurredLocalDate')
      }
    }
  })

  it('refuses a file holding two different versions of one event id', async () => {
    const backup = await sampleBackup()
    const first = backup.events[0]
    const duplicated = {
      ...backup,
      checksum: undefined,
      events: [first, { ...first, payload: { ...(first?.payload as object), value: 99 } }],
    }
    const result = await readBackup(JSON.stringify(duplicated))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.message).toContain('two different versions')
  })

  it('collapses byte-identical duplicates silently', async () => {
    const backup = await sampleBackup()
    const duplicated = {
      ...backup,
      checksum: undefined,
      events: [backup.events[0], backup.events[0]],
    }
    const result = await readBackup(JSON.stringify(duplicated))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.backup.events).toHaveLength(1)
  })

  it('accepts a backup with no checksum at all', async () => {
    const backup = await sampleBackup()
    const result = await readBackup(canonicalize({ ...backup, checksum: undefined }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.checksumVerified).toBe(false)
  })
})
