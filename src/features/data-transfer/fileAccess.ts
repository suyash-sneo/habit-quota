/**
 * Saving and opening backup files.
 *
 * Prefers the file picker where the browser has one, so the user can choose
 * iCloud Drive or any folder. Falls back to an ordinary download, which is what
 * iOS Safari offers.
 */

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{ description: string; accept: Record<string, string[]> }>
}

interface FileSystemWritableStreamLike {
  write: (data: Blob | string) => Promise<void>
  close: () => Promise<void>
}

interface FileSystemFileHandleLike {
  name: string
  createWritable: () => Promise<FileSystemWritableStreamLike>
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>

export type SaveOutcome =
  | { status: 'saved'; via: 'picker'; fileName: string }
  | { status: 'saved'; via: 'download'; fileName: string }
  | { status: 'cancelled' }

const JSON_TYPE = {
  description: 'Habit tracker backup',
  accept: { 'application/json': ['.json'] as string[] },
}

export function supportsFilePicker(): boolean {
  return typeof (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker === 'function'
}

export async function saveTextFile(fileName: string, text: string): Promise<SaveOutcome> {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker

  if (typeof picker === 'function') {
    try {
      const handle = await picker({ suggestedName: fileName, types: [JSON_TYPE] })
      const writable = await handle.createWritable()
      await writable.write(new Blob([text], { type: 'application/json' }))
      await writable.close()
      return { status: 'saved', via: 'picker', fileName: handle.name || fileName }
    } catch (error) {
      // AbortError is the user closing the picker, which is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'cancelled' }
      }
      // Anything else falls through to the download path rather than failing.
    }
  }

  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next tick so Safari has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { status: 'saved', via: 'download', fileName }
}

export function describeDestination(outcome: SaveOutcome): string {
  if (outcome.status === 'cancelled') return 'Not saved'
  return outcome.via === 'picker'
    ? 'Saved to the location you chose. Stored as a file — not synchronized.'
    : 'Saved through your browser’s downloads. Move it to iCloud Drive or another folder to keep it.'
}
