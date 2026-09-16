/**
 * Transient confirmations, including the Undo affordance that follows every
 * save, edit and delete.
 */

import { useSyncExternalStore } from 'react'
import { useApp } from '../app/providers.tsx'
import { anyOverlayOpen, subscribeOverlay } from '../app/overlay-state.ts'
import styles from './Toaster.module.css'

export function Toaster(): React.JSX.Element | null {
  const { toasts, dismissToast } = useApp()
  // A dialog owns the screen while it is open; a leftover confirmation must not
  // float over its buttons.
  const overlayOpen = useSyncExternalStore(subscribeOverlay, anyOverlayOpen, () => false)
  if (!toasts.length || overlayOpen) return null

  return (
    <div className={styles.toaster} role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`${styles.toast} ${toast.tone === 'bad' ? styles.bad : ''}`}
        >
          <span className={styles.message}>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                dismissToast(toast.id)
                void toast.action?.run()
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
