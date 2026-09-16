import { useEffect, useId, useSyncExternalStore } from 'react'
import { hasDirtyWork, markClean, markDirty, subscribeDirty } from './dirty-state.ts'

/** Registers this component's unsaved state for the duration of its life. */
export function useDirtyForm(isDirty: boolean): void {
  const token = useId()
  useEffect(() => {
    if (isDirty) markDirty(token)
    else markClean(token)
  }, [isDirty, token])

  useEffect(() => () => markClean(token), [token])
}

/** True while anything on screen has unsaved work. */
export function useHasDirtyWork(): boolean {
  return useSyncExternalStore(subscribeDirty, hasDirtyWork, () => false)
}
