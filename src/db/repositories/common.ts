/**
 * Helpers every repository needs: reading the current heads of an entity so a
 * new event can name exactly what it supersedes.
 */

import { db } from '../database.ts'
import type { EntityHeadRow } from '../schema.ts'

export class ConflictedEntityError extends Error {
  constructor(readonly entityId: string) {
    super('This item was edited on two devices and has to be resolved before it can change again.')
    this.name = 'ConflictedEntityError'
  }
}

export async function headIdsFor(entityId: string): Promise<string[]> {
  const row = (await db().entityHeads.get(entityId)) as EntityHeadRow | undefined
  return row?.headEventIds ?? []
}

/**
 * Heads to use as parents for an ordinary edit.
 *
 * Editing a conflicted entity is refused: the edit would create a third branch
 * and make the conflict harder to explain, so the user resolves it first.
 */
export async function parentsForEdit(entityId: string): Promise<string[]> {
  const row = (await db().entityHeads.get(entityId)) as EntityHeadRow | undefined
  if (!row) return []
  if (row.conflicted) throw new ConflictedEntityError(entityId)
  return row.headEventIds
}
