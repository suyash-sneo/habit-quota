/**
 * Turns raw events into the sentences the Changes view shows.
 *
 * The distinction the copy has to preserve: *when the habit occurred* versus
 * *when its record changed*. Those are separate lines, never merged.
 */

import type {
  ConflictResolutionPayload,
  DomainEvent,
  EntrySnapshot,
  GoalSnapshot,
  HabitSnapshot,
  ImportPayload,
  TrackingModel,
} from '../../domain/events/types.ts'
import { describeValue } from '../../domain/heatmap/index.ts'
import { formatMonthDay, formatWeekdayShort } from '../../domain/time/format.ts'

export interface ChangeEntry {
  eventId: string
  title: string
  detail: string
  recordedAt: string
  deviceId: string
  tone: 'positive' | 'neutral' | 'warning' | 'negative'
}

function occurrenceLine(event: DomainEvent): string {
  const date = event.occurredLocalDate
  if (!date) return ''
  return `occurred ${formatWeekdayShort(date)}, ${formatMonthDay(date)}`
}

function valueOf(snapshot: EntrySnapshot | undefined, model: TrackingModel): string {
  if (!snapshot) return ''
  return describeValue(model, snapshot.value)
}

/**
 * @param previousByEntity snapshot each entity held before this event, so an
 * edit can say what actually changed rather than just "entry changed".
 */
export function describeEvent(
  event: DomainEvent,
  model: TrackingModel,
  previous: EntrySnapshot | undefined,
): ChangeEntry {
  const base = {
    eventId: event.eventId,
    recordedAt: event.recordedAt,
    deviceId: event.deviceId,
  }

  switch (event.eventType) {
    case 'entry.created': {
      const snapshot = event.payload as EntrySnapshot
      return {
        ...base,
        title: 'Entry created',
        detail: [valueOf(snapshot, model), occurrenceLine(event)].filter(Boolean).join(' · '),
        tone: 'positive',
      }
    }
    case 'entry.updated': {
      const snapshot = event.payload as EntrySnapshot
      const parts: string[] = []
      if (previous && previous.value !== snapshot.value) {
        parts.push(
          model === 'duration'
            ? `Duration changed from ${previous.value} to ${snapshot.value} minutes`
            : `Value changed from ${previous.value} to ${snapshot.value}`,
        )
      }
      if (previous && previous.occurredLocalDate !== snapshot.occurredLocalDate) {
        parts.push(
          `Moved from ${formatMonthDay(previous.occurredLocalDate)} to ${formatMonthDay(snapshot.occurredLocalDate)}`,
        )
      }
      if (previous && (previous.note ?? '') !== (snapshot.note ?? '')) parts.push('Note changed')
      return {
        ...base,
        title: parts[0] ?? 'Entry edited',
        detail: [...parts.slice(1), occurrenceLine(event)].filter(Boolean).join(' · '),
        tone: 'warning',
      }
    }
    case 'entry.deleted':
      return {
        ...base,
        title: 'Entry deleted',
        detail: [occurrenceLine(event), 'the original values stay in this history']
          .filter(Boolean)
          .join(' · '),
        tone: 'negative',
      }
    case 'entry.restored':
      return {
        ...base,
        title: 'Entry restored',
        detail: occurrenceLine(event),
        tone: 'positive',
      }
    case 'habit.created':
      return {
        ...base,
        title: `Habit created — ${(event.payload as HabitSnapshot).displayName}`,
        detail: `${(event.payload as HabitSnapshot).trackingModel} tracking`,
        tone: 'positive',
      }
    case 'habit.updated':
      return { ...base, title: 'Habit settings changed', detail: '', tone: 'neutral' }
    case 'habit.reordered':
      return { ...base, title: 'Habit reordered', detail: '', tone: 'neutral' }
    case 'habit.archived':
      return { ...base, title: 'Habit archived', detail: 'Events kept', tone: 'neutral' }
    case 'habit.restored':
      return { ...base, title: 'Habit restored', detail: '', tone: 'positive' }
    case 'goal.created': {
      const goal = event.payload as GoalSnapshot
      return {
        ...base,
        title: 'Goal created',
        detail: `${goal.goalType} · target ${goal.targetValue}`,
        tone: 'positive',
      }
    }
    case 'goal.updated': {
      const goal = event.payload as GoalSnapshot
      return {
        ...base,
        title: 'Goal updated',
        detail: `${goal.goalType} · target ${goal.targetValue}`,
        tone: 'warning',
      }
    }
    case 'goal.deleted':
      return { ...base, title: 'Goal retired', detail: 'Past periods keep their old target', tone: 'neutral' }
    case 'conflict.resolved': {
      const payload = event.payload as ConflictResolutionPayload
      const wording: Record<ConflictResolutionPayload['decision'], string> = {
        'keep-local': 'the local value',
        'use-imported': 'the imported value',
        manual: 'a manually entered value',
        'keep-both': 'both versions',
      }
      return {
        ...base,
        title: `Conflict resolved using ${wording[payload.decision]}`,
        detail: occurrenceLine(event) || 'The losing version stays in this history',
        tone: 'warning',
      }
    }
    case 'system.imported': {
      const payload = event.payload as ImportPayload
      return {
        ...base,
        title: `${payload.newEventCount} events imported from another device`,
        detail: `From ${payload.sourceDeviceLabel} · ${payload.alreadyPresentCount} already present`,
        tone: 'positive',
      }
    }
  }
}

export function toneColor(tone: ChangeEntry['tone']): string {
  switch (tone) {
    case 'positive':
      return 'var(--grn)'
    case 'warning':
      return 'var(--amb)'
    case 'negative':
      return 'var(--crim)'
    case 'neutral':
      return 'var(--ink3)'
  }
}
