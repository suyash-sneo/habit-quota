/**
 * The single overlay primitive: a bottom sheet on mobile and a centred modal on
 * laptop, decided entirely by CSS custom properties.
 *
 * Handles what an accessible dialog owes the user — modal semantics, a focus
 * trap, Escape, and returning focus to whatever opened it.
 */

import { useCallback, useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { pushOverlay } from '../app/overlay-state.ts'
import styles from './Sheet.module.css'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface SheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra description announced with the dialog. */
  description?: string
}

export function Sheet({ open, title, onClose, children, description }: SheetProps): React.JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  /**
   * Move focus into the sheet's content — not onto the close button, which is
   * the first focusable in DOM order but the least useful place to land.
   */
  const focusFirst = useCallback(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    // If the user has already reached something inside, leave them alone.
    if (dialog.contains(document.activeElement)) return
    const body = bodyRef.current ?? dialog
    const target = body.querySelector<HTMLElement>(FOCUSABLE)
    if (target) target.focus()
    else dialog.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const releaseOverlay = pushOverlay()
    restoreTo.current = document.activeElement as HTMLElement | null
    // Synchronous: the dialog is already committed to the DOM here, and
    // deferring a frame would let focus land after the user had started typing.
    focusFirst()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      releaseOverlay()
      document.body.style.overflow = previousOverflow
      // Only restore focus if it is still somewhere inside the closing sheet.
      const opener = restoreTo.current
      if (opener?.isConnected) opener.focus?.()
    }
  }, [open, focusFirst])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const targets = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (!targets.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = targets[0] as HTMLElement
      const last = targets[targets.length - 1] as HTMLElement
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <div className={styles.spacer} />
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className={styles.body} ref={bodyRef}>
          {description ? (
            <p id={descriptionId} style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--ink2)' }}>
              {description}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  )
}
