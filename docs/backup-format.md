# Backup format

A backup is a single JSON file containing the complete event log of one device.
It is the only way data leaves the browser.

## 1. Envelope

```json
{
  "format": "habit-tracker-backup",
  "formatVersion": 1,
  "backupId": "uuid",
  "exportedAt": "2026-09-16T20:40:00.000Z",
  "appVersion": "1.0.0",
  "sourceDevice": { "deviceId": "uuid", "label": "This device" },
  "coverage": {
    "earliestLocalDate": "2026-01-01",
    "latestLocalDate": "2026-09-16",
    "latestRecordedAt": "2026-09-16T20:39:48.000Z"
  },
  "highWaterMarks": { "device-uuid": 184 },
  "eventCount": 1241,
  "events": [],
  "checksum": { "algorithm": "SHA-256", "value": "base64url" }
}
```

| Field | Meaning |
| --- | --- |
| `coverage` | Earliest and latest *occurrence* in the log, plus the most recent record time |
| `highWaterMarks` | Highest device sequence seen per device, so an importer can detect gaps |
| `events` | Every event, in canonical order (below) |
| `checksum` | Optional. Detects accidental corruption |

## 2. Event order

Events are sorted by `recordedAt`, then `deviceId`, then `deviceSequence`, then
`eventId`. Two exports of the same log are therefore byte-identical and diffable.

Each event is normalised before writing: keys the envelope schema does not define
are dropped, so a file written by a future build cannot smuggle extra fields
through a round trip and change the checksum.

## 3. Canonical JSON, version 1

The checksum is computed over a canonical serialization, frozen for
`formatVersion` 1:

1. Object keys are sorted ascending by UTF-16 code unit.
2. Keys whose value is `undefined` are dropped entirely.
3. Arrays keep their order; an `undefined` element becomes `null`.
4. No insignificant whitespace.
5. Strings and numbers use `JSON.stringify`'s own escaping. Non-finite numbers
   are rejected rather than silently becoming `null`.

Worked vectors (asserted in `src/domain/backup/backup.test.ts`):

| Input | Canonical form |
| --- | --- |
| `{ b: 1, a: 2 }` | `{"a":2,"b":1}` |
| `{ a: undefined, b: 1 }` | `{"b":1}` |
| `{ z: { y: 1, x: 2 } }` | `{"z":{"x":2,"y":1}}` |
| `[3, 1, 2]` | `[3,1,2]` |
| `{ "2": "b", "10": "a" }` | `{"10":"a","2":"b"}` |
| `-1.5` | `-1.5` |
| `'a"b'` | `"a\"b"` |

Note the last object: sorting is by code unit, not numerically, so `"10"` sorts
before `"2"`.

## 4. Checksum

```
value = base64url( SHA-256( UTF-8( canonicalize(backup without "checksum") ) ) )
```

Base64url uses `-` and `_`, and padding is stripped.

**What this does and does not promise.** The checksum detects accidental
corruption — a truncated download, a text editor that re-encoded the file, a
flaky transfer. It is **not** an authenticity guarantee. Anyone who edits the
file can recompute it. Treat a matching checksum as "this file is intact", never
as "this file is trustworthy".

A backup with no `checksum` field is accepted; the import preview says the
checksum was absent rather than verified.

## 5. Reading a backup

Validation runs in this order, and **nothing is written to the database at any
point during it**:

1. Size limit (64 MB).
2. `JSON.parse`.
3. Envelope schema.
4. `formatVersion` support.
5. Every event validated individually against the event schema.
6. Duplicate `eventId` detection.
7. Checksum verification.

### Failure categories

| Category | Message | Cause |
| --- | --- | --- |
| `too-large` | That file is larger than this app will read | Over 64 MB |
| `unreadable` | That file is not valid JSON | Parse failure |
| `wrong-format` | That file is not a habit tracker backup | Envelope mismatch |
| `unsupported-version` | This backup was created by a newer app version | `formatVersion` unknown |
| `checksum-mismatch` | That file's checksum does not match its contents | Corruption |
| `validation` | Some events in that file did not pass validation | Bad event fields |

Two events sharing an `eventId` with **identical** content collapse silently. Two
sharing an id with **different** content abort the whole import: either that file
or the local log is wrong, and guessing would destroy history.

## 6. Merging

Import is compared, previewed, then committed. See
[`event-model.md`](./event-model.md) for heads and conflicts.

1. **Already present** — same `eventId`, identical canonical content.
2. **Same id, different content** — refuse the entire file.
3. **New** — absent locally; will be added.
4. For every affected entity, compute heads over the union.
5. One head, or one head descending from all the others → no conflict.
6. Divergent heads → a decision is required before merging.
7. Compute per-device sequence gaps across the union.

The preview states `alreadyPresentCount`, `newEventCount`, `conflictCount`,
`missingSequenceCount`, the source devices, coverage before and after, and the
projected total.

A **pre-merge snapshot** is created before the first row is written. The commit
itself is one transaction: imported events, local resolution events, a
`system.imported` audit event, the import record, and the projection refresh. If
it fails, nothing was written.

Rollback restores the snapshot by replacing the event set. That is a replacement,
not a domain event, and the interface says so plainly.

## 7. Privacy

The file is readable text. It contains your timestamps, values and notes.

- A private habit's name is stored as `Private` and nothing else — the real name
  is never written into an event, so it cannot appear in a backup.
- Backup filenames are generic (`habit-backup-YYYY-MM-DD.json`) and never name a
  habit.
- The export sheet states plainly that the file is plaintext before you save it.
- Exporting is not synchronization. Nothing leaves the device until you choose a
  location, and nothing keeps the file up to date afterwards.

## 8. Compatibility

- Export always writes the latest format.
- Import supports every version in `SUPPORTED_FORMAT_VERSIONS`.
- An unknown newer version fails safely with a clear message rather than a
  best-effort guess.
- When `formatVersion` 2 arrives, version 1 files must keep importing, and that
  must be covered by a fixture test before the change ships.
