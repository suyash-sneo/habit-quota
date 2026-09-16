/**
 * Row shapes stored in IndexedDB.
 *
 * `events` is authoritative. Everything else is a projection that can be
 * dropped and rebuilt from it, so a schema change to a view table is never a
 * data migration — it is a `projectionVersion` bump.
 */

import type { DomainEvent } from '../domain/events/types.ts'
import type { EntryView, GoalView, HabitView } from '../domain/events/project.ts'

/** Stable, app-specific, and deliberately not derived from the repository path. */
export const DATABASE_NAME = 'habit-tracker-local-v1'
export const DATABASE_VERSION = 1

/**
 * IndexedDB cannot index a boolean, so view rows carry a 0/1 mirror of each
 * boolean the app needs to query on. The boolean stays authoritative.
 */
export type Flag = 0 | 1

export type EventRow = DomainEvent

export type HabitViewRow = HabitView & { archivedFlag: Flag }

export type GoalViewRow = GoalView & { activeFlag: Flag }

export type EntryViewRow = EntryView & { deletedFlag: Flag }

export interface EntityHeadRow {
  entityId: string
  entityType: DomainEvent['entityType']
  habitId?: string
  headEventIds: string[]
  conflicted: boolean
}

export interface DeviceRow {
  deviceId: string
  label: string
  /** Sequence to hand to the next locally created event. Starts at 1. */
  nextSequence: number
  createdAt: string
  isThisDevice: boolean
}

export interface ImportRow {
  importId: string
  backupId: string
  importedAt: string
  sourceDeviceId: string
  sourceDeviceLabel: string
  fileName: string
  newEventCount: number
  alreadyPresentCount: number
  conflictCount: number
  snapshotId: string | null
  rolledBackAt: string | null
}

export interface ExportRow {
  exportId: string
  exportedAt: string
  fileName: string
  eventCount: number
  earliestLocalDate: string | null
  latestLocalDate: string | null
  /** What the user was told about where it went. Never a filesystem handle. */
  destinationNote: string
}

export interface SnapshotRow {
  snapshotId: string
  createdAt: string
  reason: 'pre-merge' | 'manual'
  eventCount: number
  events: DomainEvent[]
  deviceRows: DeviceRow[]
}

/* -------------------------------------------------------------- meta keys */

export interface AppSettings {
  timezoneId: string
  weekStartsOn: 1 | 2 | 3 | 4 | 5 | 6 | 7
  theme: 'dark' | 'light'
  onboardedAt: string | null
}

export interface StorageStatus {
  persistedGranted: boolean
  askedAt: string | null
}

export interface MetaRow<T = unknown> {
  key: string
  value: T
}

export const META_KEYS = {
  settings: 'settings',
  thisDeviceId: 'thisDeviceId',
  lastSelectedHabitId: 'lastSelectedHabitId',
  projectionVersion: 'projectionVersion',
  storageStatus: 'storageStatus',
  updateDeferredAt: 'updateDeferredAt',
} as const

export const DEFAULT_SETTINGS: AppSettings = {
  timezoneId: 'UTC',
  weekStartsOn: 1,
  theme: 'dark',
  onboardedAt: null,
}
