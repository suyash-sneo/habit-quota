/**
 * How many modal sheets are currently on screen.
 *
 * The toaster subscribes to this so a confirmation from a previous action can
 * never sit on top of an open dialog and swallow clicks meant for its buttons.
 */

let openCount = 0
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function pushOverlay(): () => void {
  openCount += 1
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    openCount -= 1
    notify()
  }
}

export function anyOverlayOpen(): boolean {
  return openCount > 0
}

export function subscribeOverlay(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
