/**
 * Parsing, checksum verification and merge planning, off the main thread.
 *
 * The worker never touches IndexedDB. It is handed the local events and the
 * file text, and it returns a plain description of what a merge would do.
 */

import { readBackup } from '../domain/backup/build.ts'
import type { BackupReadFailure } from '../domain/backup/build.ts'
import { DuplicateEventMismatchError, planImport } from '../domain/merge/plan.ts'
import type { ImportPlan } from '../domain/merge/plan.ts'
import type { DomainEvent } from '../domain/events/types.ts'

export interface ImportWorkerRequest {
  requestId: number
  fileText: string
  fileName: string
  localEvents: DomainEvent[]
}

/**
 * The result of planning, without the correlation id.
 *
 * Written as its own union rather than `Omit<ImportWorkerResponse, ...>`,
 * because `Omit` over a union collapses it into one non-discriminated shape.
 */
export type ImportPlanResult =
  | { ok: true; plan: ImportPlan; checksumVerified: boolean }
  | { ok: false; failure: BackupReadFailure }

export type ImportWorkerResponse = ImportPlanResult & { requestId: number }

export async function runImportPlan(
  request: Omit<ImportWorkerRequest, 'requestId'>,
): Promise<ImportPlanResult> {
  const read = await readBackup(request.fileText)
  if (!read.ok) return { ok: false, failure: read.failure }

  try {
    const plan = planImport(request.localEvents, read.backup)
    return { ok: true, plan, checksumVerified: read.checksumVerified }
  } catch (error) {
    if (error instanceof DuplicateEventMismatchError) {
      return {
        ok: false,
        failure: {
          kind: 'validation',
          message: error.message,
          issues: [`event ${error.eventId}`],
        },
      }
    }
    return {
      ok: false,
      failure: {
        kind: 'validation',
        message: 'That file could not be compared with your local history.',
        issues: [error instanceof Error ? error.message : String(error)],
      },
    }
  }
}

self.addEventListener('message', (event: MessageEvent<ImportWorkerRequest>) => {
  const request = event.data
  void runImportPlan(request).then((result) => {
    ;(self as unknown as Worker).postMessage({ ...result, requestId: request.requestId })
  })
})
