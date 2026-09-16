# Event model

This document is the reference for how habit data is represented. It describes
what is authoritative, what is derived, and the exact rules the code follows so
that two devices can be merged without losing anything.

## 1. The event log is authoritative

Every user-meaningful change is an immutable `DomainEvent`. Habits, goals,
entries, daily totals, streaks and goal progress are **projections**: they can be
deleted and rebuilt from the log at any time without loss.

Three things follow, and they are not negotiable:

- An event is never updated or deleted in place.
- A current streak is never stored as a fact; it is always recomputed.
- Timestamps never decide which of two conflicting edits wins.

## 2. Event shape

```ts
interface DomainEvent<TPayload = unknown> {
  schemaVersion: 1
  eventId: string          // UUID, unique across all devices
  entityId: string         // the habit / goal / entry this event is about
  entityType: 'habit' | 'goal' | 'entry' | 'system'
  habitId?: string
  eventType: EventType
  parentEventIds: string[] // the heads this event supersedes
  deviceId: string
  deviceSequence: number   // monotonic per device, starting at 1
  recordedAt: string       // RFC 3339 UTC — when the record was written
  occurredAt?: string      // RFC 3339 UTC — when the activity happened
  occurredLocalDate?: string // YYYY-MM-DD in the habit's timezone
  timezoneId?: string      // IANA zone in force at the time
  payload: TPayload
}
```

`recordedAt` and `occurredAt` answer different questions and are always shown
separately in the interface: *when did this happen* versus *when did the record
of it change*.

### Event types

| Event | Payload | Meaning |
| --- | --- | --- |
| `habit.created` | `HabitSnapshot` | A habit exists |
| `habit.updated` | `HabitSnapshot` | Name, threshold, label or model changed |
| `habit.reordered` | `{ sortOrder }` | Position in the dropdown changed |
| `habit.archived` / `habit.restored` | `HabitSnapshot` | Hidden from / returned to the dropdown |
| `goal.created` / `goal.updated` | `GoalSnapshot` | A goal definition |
| `goal.deleted` | `GoalSnapshot` (`active: false`) | Retired as of a local date |
| `entry.created` / `entry.updated` | `EntrySnapshot` | An entry's current value |
| `entry.deleted` / `entry.restored` | `EntrySnapshot` | Tombstone / un-tombstone |
| `conflict.resolved` | `ConflictResolutionPayload` | A merge decision |
| `system.imported` | `ImportPayload` | An import happened |

Every payload except `habit.reordered` and `conflict.resolved` is a **complete
replacement snapshot**, so a projection never needs an earlier event to
interpret a later one. `habit.reordered` patches only `sortOrder` onto its
parent, and `conflict.resolved` carries the chosen snapshot inside
`resolvedSnapshot`.

## 3. The DAG, heads and conflicts

Each entity's events form a directed acyclic graph:

- A root event has `parentEventIds: []`.
- An ordinary edit names the single current head as its parent.
- A delete is a new head — it hides the entry, it does not erase it.
- A restore follows a delete.
- A conflict resolution names **all** conflicting heads as parents, exactly like
  a merge commit.

**Head calculation.** Take every event id for the entity, then remove every id
that appears in some other event's `parentEventIds`. What remains are the heads.
Parent references to events we do not hold are ignored, so a partial log still
has usable heads.

- One head → resolved. Its snapshot is current.
- Two or more heads → **conflicted**. The row is flagged, excluded from every
  total, and locked against further editing until a person decides.

An entity is *not* conflicted when one head descends from all the others; that is
simply a newer edit arriving, and the descendant becomes current.

## 4. Replay order

Replay is deterministic so a rebuild always produces identical views:

1. Satisfy parent dependencies first (topological order).
2. Break ties between independent events by `recordedAt`, then `deviceId`, then
   `deviceSequence`, then `eventId`.

This order exists for reproducibility only. **It never picks a conflict winner.**
A device with a wrong clock changes presentation order, never which edit survives.

## 5. Device sequences

Each device keeps a `nextSequence` counter. Every locally authored event takes
the next number inside the same transaction that stores it, so a failed write
consumes nothing and leaves no gap.

A sequence establishes order *within one device only*. Comparing sequences across
devices is meaningless. Gaps in a device's sequence, seen from another device's
backup, mean that backup does not contain everything that device recorded — the
Data screen reports this as an integrity note, not an error.

## 6. Local dates are labels, not instants

`occurredLocalDate` is the date the user chose, stored as a string. It is
authoritative for the heatmap, daily totals, weekly totals and streaks, **forever**.

A historical local date is never recomputed from the current device timezone. If
you move from Los Angeles to Tokyo, an entry logged on September 16 stays on
September 16. `occurredAt` (the exact instant) is derived once, at entry time,
from the local date, the wall-clock time and the zone then in force, and is then
frozen.

### DST edge cases

`instantFromWallClock` resolves the two awkward cases deliberately:

- **Ambiguous** — the hour repeated each autumn resolves to its *first*
  occurrence, while the zone is still on summer time.
- **Nonexistent** — the hour skipped each spring resolves *forward* past the gap,
  so "2:30 AM" on a spring-forward day stores 3:30 AM on that same local date
  rather than silently moving to the hour before.

Local days are not assumed to be 1440 minutes; `minutesInLocalDay` reports 1380
or 1500 on transition days.

## 7. Aggregation rules

For a habit and a local date, over entries that are current, not deleted and not
conflicted:

| Tracking model | Day value |
| --- | --- |
| `duration` | Sum of minutes |
| `count` | Sum of values |
| `completion` | Number of entries |
| `negative-occurrence` | Number of entries |

Several entries may share a date; for a negative habit they each count toward the
weekly maximum but together form a single calendar-day interval.

## 8. Streaks

A day qualifies when its aggregate meets the habit's `streakThreshold`. A
completion habit qualifies on a single session regardless of the configured
number.

- If **today** qualifies, count backward from today.
- If today does not qualify, count backward from **yesterday** and mark today
  *pending*. A streak is never reported as broken while the local day is still
  open.
- Stop at the first completed day that fails.
- Future dates never participate.
- An empty day means nothing was recorded — not a confirmed zero.

For negative habits the equivalent figure is the number of whole local days since
the most recent occurrence; the longest interval includes the interval currently
running.

## 9. Goals

**The rule that must stay consistent everywhere: today is included in the
remaining days while it is still open.** A deadline of December 31 evaluated on
December 31 has one day left, not zero.

- `cumulative-by-deadline` — progress from the goal's effective start through
  today; `requiredPerDay = ceil(remaining / daysRemaining)`. "On pace" means the
  work left per remaining day is no worse than the flat rate the goal implied on
  the day it started.
- `periodic-minimum` / `periodic-maximum` — evaluated over the current period
  window, aligned to the configured week start.
- A goal edit never rewrites history. The old definition stays in the log, and
  the new one applies from its `effectiveFromLocalDate`.

## 10. Conflict resolution

Four decisions, all of them additive:

| Decision | Result |
| --- | --- |
| Keep local | Resolution event carrying the local snapshot |
| Use imported | Resolution event carrying the imported snapshot |
| Edit manually | Resolution event carrying a newly entered snapshot |
| Keep both | Resolution keeps one branch; the other becomes a **new entry entity** with `sourceEntryId` pointing at the original |

In every case the resolution names all previous heads as parents, so both
branches remain in the log and stay visible in the Changes view. **No
authoritative event is ever removed by a resolution.**

## 11. Invariants the tests enforce

These are asserted in `src/domain/**/*.test.ts` and `src/db/database.test.ts`:

- Importing the same backup twice is idempotent.
- The union of two logs is commutative before any local resolution.
- A projection rebuild reproduces byte-identical views.
- Projection output is independent of input order.
- No authoritative event is lost by conflict resolution.
- A failed import or a failed write leaves the database logically unchanged.
- A write that fails validation consumes no device sequence.

## 12. Versioning

Three versions move independently:

| Version | Where | Changes when |
| --- | --- | --- |
| IndexedDB schema | `DATABASE_VERSION` | Table or index layout changes |
| Event `schemaVersion` | `EVENT_SCHEMA_VERSION` | The meaning of an event changes |
| Backup `formatVersion` | `BACKUP_FORMAT_VERSION` | The file envelope changes |

An IndexedDB migration never changes the meaning of an old event. Old events are
upgraded in memory before projection. Projection changes are not migrations at
all: bump `PROJECTION_VERSION`, and the next launch clears the view tables and
replays the log.
