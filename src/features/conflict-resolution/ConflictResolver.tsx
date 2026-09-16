/**
 * Conflict comparison and resolution.
 *
 * Shows the common ancestor, both branches, and what each choice would produce
 * — then records the decision as a merge event. The losing branch is never
 * deleted; it stays in the change history behind the resolution.
 */

import { useMemo, useState } from 'react'
import { Sheet } from '../../components/Sheet.tsx'
import type { PlannedConflict } from '../../domain/merge/plan.ts'
import { diffEntrySnapshots } from '../../domain/merge/plan.ts'
import type { ConflictDecision } from '../../domain/merge/resolve.ts'
import type { EntrySnapshot, TrackingModel } from '../../domain/events/types.ts'
import { describeValue } from '../../domain/heatmap/index.ts'
import { formatInstant, formatMonthDay, formatClock } from '../../domain/time/format.ts'
import selectorStyles from '../habit-selector/HabitSelector.module.css'
import styles from './ConflictResolver.module.css'

export interface ConflictResolverProps {
  open: boolean
  conflict: PlannedConflict | null
  /** Position in the queue, for "Conflict 1 of 3". */
  index: number
  total: number
  habitLabel: string
  model: TrackingModel
  timezoneId: string
  deviceLabels: Map<string, string>
  onResolve: (decision: ConflictDecision) => void
  onClose: () => void
}

function asEntry(snapshot: unknown): EntrySnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  return snapshot as EntrySnapshot
}

export function ConflictResolver({
  open,
  conflict,
  index,
  total,
  habitLabel,
  model,
  timezoneId,
  deviceLabels,
  onResolve,
  onClose,
}: ConflictResolverProps): React.JSX.Element {
  const [choice, setChoice] = useState<ConflictDecision['kind']>('keep-local')
  const [manualValue, setManualValue] = useState('')

  const local = asEntry(conflict?.heads.find((h) => h.origin !== 'imported')?.snapshot)
  const imported = asEntry(conflict?.heads.find((h) => h.origin !== 'local')?.snapshot)
  const ancestor = asEntry(conflict?.ancestorSnapshot)

  const differences = useMemo(() => diffEntrySnapshots(local, imported), [local, imported])

  const options = useMemo(() => {
    if (!conflict) return []
    const isEntry = conflict.entityType === 'entry'
    const rows: Array<{
      kind: ConflictDecision['kind']
      label: string
      value: string
      meta: string
    }> = [
      {
        kind: 'keep-local',
        label: 'Keep local',
        value: local ? describeValue(model, local.value) : '—',
        meta: headMeta(conflict, 'local', timezoneId, deviceLabels),
      },
      {
        kind: 'use-imported',
        label: 'Use imported',
        value: imported ? describeValue(model, imported.value) : '—',
        meta: headMeta(conflict, 'imported', timezoneId, deviceLabels),
      },
    ]
    if (isEntry) {
      rows.push({
        kind: 'keep-both',
        label: 'Keep both',
        value:
          local && imported
            ? `${describeValue(model, local.value)} + ${describeValue(model, imported.value)}`
            : '—',
        meta: local
          ? `Two separate sessions on ${formatMonthDay(local.occurredLocalDate)}`
          : 'Two separate entries',
      })
    }
    rows.push({
      kind: 'manual',
      label: 'Edit manually',
      value: manualValue ? describeValue(model, Number(manualValue) || 0) : '—',
      meta: 'Enter a value yourself',
    })
    return rows
  }, [conflict, local, imported, model, manualValue, timezoneId, deviceLabels])

  const projected = useMemo(() => {
    if (!conflict || !local || !imported) return ''
    const date = formatMonthDay(local.occurredLocalDate)
    switch (choice) {
      case 'keep-local':
        return `${date} keeps ${describeValue(model, local.value)}.`
      case 'use-imported':
        return `${date} becomes ${describeValue(model, imported.value)}.`
      case 'keep-both':
        return `${date} becomes ${describeValue(model, local.value + imported.value)} across two entries.`
      case 'manual':
        return `${date} becomes ${describeValue(model, Number(manualValue) || 0)}.`
    }
  }, [choice, conflict, local, imported, model, manualValue])

  const apply = (): void => {
    if (choice === 'manual') {
      const value = Number(manualValue)
      if (!Number.isFinite(value) || value <= 0 || !local) return
      onResolve({ kind: 'manual', snapshot: { ...local, value: Math.round(value) } })
      return
    }
    onResolve({ kind: choice })
  }

  return (
    <Sheet
      open={open && conflict !== null}
      title={total > 1 ? `Resolve conflict ${index + 1} of ${total}` : 'Resolve conflict'}
      onClose={onClose}
      description="Both devices edited the same logical entry. Nothing is written until you choose."
    >
      <div className={styles.summary}>
        <Row label="Habit" value={habitLabel} />
        <Row
          label="Occurred"
          value={
            local
              ? `${formatMonthDay(local.occurredLocalDate)}${
                  local.startTime !== undefined ? ` · ${formatClock(local.startTime)}` : ''
                }`
              : '—'
          }
        />
        <Row
          label="Ancestor"
          value={
            ancestor
              ? `${describeValue(model, ancestor.value)} · common starting point`
              : 'No shared starting point'
          }
        />
      </div>

      {differences.length ? (
        <div className={styles.diff}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            What differs
          </div>
          {differences.map((d) => (
            <div className={styles.diffRow} key={String(d.field)}>
              <span className={styles.diffField}>{String(d.field)}</span>
              <span style={{ color: 'var(--ink2)' }}>{String(d.from ?? '—')}</span>
              <span style={{ color: 'var(--ink3)' }}>vs</span>
              <span style={{ fontWeight: 600 }}>{String(d.to ?? '—')}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div
        role="radiogroup"
        aria-label="Resolution"
        style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}
      >
        {options.map((option) => (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={choice === option.kind}
            className={`${styles.option} ${choice === option.kind ? styles.optionSelected : ''}`}
            onClick={() => setChoice(option.kind)}
          >
            <span className={styles.optionHead}>
              <span className={selectorStyles.radio} aria-hidden="true" />
              <span style={{ fontWeight: 600, fontSize: 14.5 }}>{option.label}</span>
              <span style={{ flex: 1 }} />
              <span className="num" style={{ fontWeight: 600, fontSize: 14.5 }}>
                {option.value}
              </span>
            </span>
            <span className={styles.optionMeta}>{option.meta}</span>
          </button>
        ))}
      </div>

      {choice === 'manual' ? (
        <div style={{ marginTop: 14 }}>
          <label className="fieldLabel" htmlFor="conflict-manual">
            Merged value
          </label>
          <input
            id="conflict-manual"
            className="field num"
            type="number"
            inputMode="numeric"
            min={1}
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
          />
        </div>
      ) : null}

      <div className={styles.projected}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Projected result
        </div>
        <p style={{ fontSize: 14, margin: 0 }}>{projected}</p>
        <p style={{ fontSize: 12.5, color: 'var(--ink2)', margin: '6px 0 0' }}>
          Streak and goal totals update after the merge. The losing version stays in the change
          history.
        </p>
      </div>

      <div className={selectorStyles.actions}>
        <button
          type="button"
          className={`btnSecondary ${selectorStyles.actionsShrink}`}
          onClick={onClose}
        >
          Back
        </button>
        <button
          type="button"
          className={`btnPrimary ${selectorStyles.actionsGrow}`}
          onClick={apply}
          disabled={choice === 'manual' && !(Number(manualValue) > 0)}
        >
          Resolve conflict
        </button>
      </div>
    </Sheet>
  )
}

function headMeta(
  conflict: PlannedConflict,
  origin: 'local' | 'imported',
  timezoneId: string,
  deviceLabels: Map<string, string>,
): string {
  const head =
    conflict.heads.find((h) => h.origin === origin) ?? conflict.heads.find((h) => h.origin === 'both')
  if (!head) return '—'
  return `Edited ${formatInstant(head.recordedAt, timezoneId)} · ${
    deviceLabels.get(head.deviceId) ?? 'Another device'
  }`
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className="num">{value}</span>
    </div>
  )
}
