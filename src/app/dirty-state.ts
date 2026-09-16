/**
 * A tiny registry of "there is unsaved work on screen".
 *
 * The service-worker update prompt and the route guards both consult it so a
 * reload never lands in the middle of an entry edit or an import resolution.
 */

const dirty = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function markDirty(token: string): void {
  if (dirty.has(token)) return
  dirty.add(token)
  notify()
}

export function markClean(token: string): void {
  if (!dirty.delete(token)) return
  notify()
}

export function hasDirtyWork(): boolean {
  return dirty.size > 0
}

export function subscribeDirty(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
