/**
 * Talks to the import worker, and falls back to running the same code inline
 * where Workers are unavailable (older WebKit in some standalone contexts, and
 * the jsdom test environment).
 */

import type {
  ImportPlanResult,
  ImportWorkerRequest,
  ImportWorkerResponse,
} from '../../workers/import-worker.ts'
import type { DomainEvent } from '../../domain/events/types.ts'

export type PlanResult = ImportPlanResult

let worker: Worker | null = null
let nextRequestId = 1

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('../../workers/import-worker.ts', import.meta.url), {
      type: 'module',
    })
    return worker
  } catch {
    return null
  }
}

export async function planImportFile(input: {
  fileText: string
  fileName: string
  localEvents: DomainEvent[]
}): Promise<PlanResult> {
  const instance = ensureWorker()
  if (!instance) {
    const { runImportPlan } = await import('../../workers/import-worker.ts')
    return runImportPlan(input)
  }

  const requestId = nextRequestId++
  return new Promise<PlanResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent<ImportWorkerResponse>): void => {
      if (event.data.requestId !== requestId) return
      cleanup()
      const { requestId: _drop, ...rest } = event.data
      void _drop
      resolve(rest as PlanResult)
    }
    const onError = (event: ErrorEvent): void => {
      cleanup()
      reject(new Error(event.message || 'The import worker failed.'))
    }
    function cleanup(): void {
      instance?.removeEventListener('message', onMessage as EventListener)
      instance?.removeEventListener('error', onError as EventListener)
    }

    instance.addEventListener('message', onMessage as EventListener)
    instance.addEventListener('error', onError as EventListener)
    instance.postMessage({ ...input, requestId } satisfies ImportWorkerRequest)
  })
}

export function terminateImportWorker(): void {
  worker?.terminate()
  worker = null
}
