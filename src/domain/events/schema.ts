/**
 * Runtime validation for everything that crosses a trust boundary: form input,
 * rows read back from IndexedDB, and — most importantly — imported backup files.
 *
 * A payload that fails here never reaches a projection.
 */

import { z } from 'zod'
import { isLocalDate } from '../time/civil.ts'
import { isSupportedTimezone } from '../time/zone.ts'
import { EVENT_SCHEMA_VERSION } from './types.ts'

export const localDateSchema = z
  .string()
  .refine(isLocalDate, { message: 'Expected a YYYY-MM-DD local date' })

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isSupportedTimezone, { message: 'Unknown IANA timezone' })

export const instantSchema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), {
  message: 'Expected an RFC 3339 instant',
})

export const uuidSchema = z.string().min(8).max(64)

export const trackingModelSchema = z.enum(['duration', 'completion', 'count', 'negative-occurrence'])

export const unitSchema = z.enum(['minutes', 'sessions', 'count', 'events'])

export const weekStartSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
])

const minuteOfDaySchema = z.number().int().min(0).max(1439)

/** Notes are stored and rendered as plain text; never as markup. */
const noteSchema = z.string().max(2000)

export const habitSnapshotSchema = z.object({
  habitId: uuidSchema,
  displayName: z.string().min(1).max(80),
  trackingModel: trackingModelSchema,
  unit: unitSchema,
  isPrivate: z.boolean(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  createdLocalDate: localDateSchema,
  streakThreshold: z.number().int().min(1).max(100000),
  logLabel: z.string().min(1).max(40),
})

export const habitReorderPayloadSchema = z.object({
  sortOrder: z.number().int(),
})

export const goalSnapshotSchema = z
  .object({
    goalId: uuidSchema,
    habitId: uuidSchema,
    goalType: z.enum(['cumulative-by-deadline', 'periodic-minimum', 'periodic-maximum', 'streak']),
    metric: z.enum(['duration-minutes', 'completion-count', 'occurrence-count']),
    targetValue: z.number().min(0).max(10_000_000),
    period: z.enum(['day', 'week', 'month', 'year']).optional(),
    deadlineLocalDate: localDateSchema.optional(),
    effectiveFromLocalDate: localDateSchema,
    effectiveToLocalDate: localDateSchema.optional(),
    timezoneId: timezoneSchema,
    weekStartsOn: weekStartSchema,
    active: z.boolean(),
  })
  .superRefine((goal, ctx) => {
    if (goal.goalType === 'cumulative-by-deadline' && !goal.deadlineLocalDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['deadlineLocalDate'],
        message: 'A cumulative goal needs a deadline',
      })
    }
    const periodic = goal.goalType === 'periodic-minimum' || goal.goalType === 'periodic-maximum'
    if (periodic && !goal.period) {
      ctx.addIssue({ code: 'custom', path: ['period'], message: 'A periodic goal needs a period' })
    }
    if (goal.goalType !== 'streak' && goal.targetValue <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetValue'],
        message: 'Target must be greater than zero',
      })
    }
    if (
      goal.effectiveToLocalDate &&
      goal.effectiveToLocalDate < goal.effectiveFromLocalDate
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveToLocalDate'],
        message: 'Goal cannot end before it starts',
      })
    }
  })

export const entrySnapshotSchema = z
  .object({
    entryId: uuidSchema,
    habitId: uuidSchema,
    occurredAt: instantSchema.optional(),
    occurredLocalDate: localDateSchema,
    timezoneId: timezoneSchema,
    value: z.number().min(0).max(10_000_000),
    unit: unitSchema,
    startTime: minuteOfDaySchema.optional(),
    endTime: minuteOfDaySchema.optional(),
    note: noteSchema.optional(),
    sourceEntryId: uuidSchema.optional(),
    deleted: z.boolean(),
  })
  .superRefine((entry, ctx) => {
    if (entry.unit === 'minutes' && !Number.isInteger(entry.value)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Duration must be a whole number of minutes',
      })
    }
    if (!entry.deleted && entry.value <= 0) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value must be greater than zero' })
    }
  })

export const importPayloadSchema = z.object({
  importId: uuidSchema,
  backupId: uuidSchema,
  sourceDeviceId: uuidSchema,
  sourceDeviceLabel: z.string().max(80),
  newEventCount: z.number().int().min(0),
  alreadyPresentCount: z.number().int().min(0),
  conflictCount: z.number().int().min(0),
})

export const conflictResolutionPayloadSchema = z.object({
  decision: z.enum(['keep-local', 'use-imported', 'manual', 'keep-both']),
  resolvedSnapshot: z.unknown(),
  splitEntityId: uuidSchema.optional(),
})

export const eventTypeSchema = z.enum([
  'habit.created',
  'habit.updated',
  'habit.reordered',
  'habit.archived',
  'habit.restored',
  'goal.created',
  'goal.updated',
  'goal.deleted',
  'entry.created',
  'entry.updated',
  'entry.deleted',
  'entry.restored',
  'conflict.resolved',
  'system.imported',
])

/** Shape validation for the envelope, independent of the payload. */
export const domainEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  eventId: uuidSchema,
  entityId: uuidSchema,
  entityType: z.enum(['habit', 'goal', 'entry', 'system']),
  habitId: uuidSchema.optional(),
  eventType: eventTypeSchema,
  parentEventIds: z.array(uuidSchema).max(64),
  deviceId: uuidSchema,
  deviceSequence: z.number().int().min(0),
  recordedAt: instantSchema,
  occurredAt: instantSchema.optional(),
  occurredLocalDate: localDateSchema.optional(),
  timezoneId: timezoneSchema.optional(),
  payload: z.unknown(),
})

function payloadSchemaFor(eventType: string): z.ZodType<unknown> {
  switch (eventType) {
    case 'habit.created':
    case 'habit.updated':
    case 'habit.archived':
    case 'habit.restored':
      return habitSnapshotSchema
    case 'habit.reordered':
      return habitReorderPayloadSchema
    case 'goal.created':
    case 'goal.updated':
    case 'goal.deleted':
      return goalSnapshotSchema
    case 'entry.created':
    case 'entry.updated':
    case 'entry.deleted':
    case 'entry.restored':
      return entrySnapshotSchema
    case 'conflict.resolved':
      return conflictResolutionPayloadSchema
    case 'system.imported':
      return importPayloadSchema
    default:
      return z.unknown()
  }
}

/**
 * Validates envelope then payload. Returned as a discriminated result rather
 * than a throw so an import can report every bad event at once.
 */
export function validateDomainEvent(
  input: unknown,
): { ok: true; value: unknown } | { ok: false; issues: string[] } {
  const envelope = domainEventEnvelopeSchema.safeParse(input)
  if (!envelope.success) {
    return { ok: false, issues: envelope.error.issues.map(describeIssue) }
  }
  const payload = payloadSchemaFor(envelope.data.eventType).safeParse(envelope.data.payload)
  if (!payload.success) {
    return {
      ok: false,
      issues: payload.error.issues.map((i) => `payload: ${describeIssue(i)}`),
    }
  }
  return { ok: true, value: { ...envelope.data, payload: payload.data } }
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length ? issue.path.join('.') : '(root)'
  return `${path}: ${issue.message}`
}
