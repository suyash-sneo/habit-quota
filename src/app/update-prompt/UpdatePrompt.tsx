/**
 * Service-worker update prompt.
 *
 * Never reloads on its own: a new version waits until the user says so, and the
 * "Update now" button stays disabled while a form on screen is dirty.
 */

import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useHasDirtyWork } from '../useDirtyForm.ts'
import styles from './UpdatePrompt.module.css'

export function UpdatePrompt(): React.JSX.Element | null {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new build when the app comes back to the foreground.
      if (!registration) return
      const check = (): void => {
        if (document.visibilityState === 'visible') void registration.update()
      }
      document.addEventListener('visibilitychange', check)
    },
  })

  const dirty = useHasDirtyWork()
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    if (!offlineReady) return
    const timer = window.setTimeout(() => setOfflineReady(false), 6000)
    return () => window.clearTimeout(timer)
  }, [offlineReady, setOfflineReady])

  if (needRefresh) {
    return (
      <div className={styles.prompt} role="status" aria-live="polite">
        <div>
          <div className={styles.title}>New version available</div>
          <div className={styles.detail}>
            {dirty
              ? 'Finish or cancel what you are editing first — nothing will reload while you have unsaved work.'
              : 'Reloads the app. Your data stays exactly where it is.'}
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className="btnSecondary"
            onClick={() => setNeedRefresh(false)}
            disabled={updating}
          >
            Later
          </button>
          <button
            type="button"
            className="btnPrimary"
            disabled={dirty || updating}
            onClick={() => {
              setUpdating(true)
              void updateServiceWorker(true)
            }}
          >
            {updating ? 'Updating…' : 'Update now'}
          </button>
        </div>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div className={styles.prompt} role="status" aria-live="polite">
        <div>
          <div className={styles.title}>Ready to work offline</div>
          <div className={styles.detail}>The app will open without a connection from now on.</div>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btnSecondary" onClick={() => setOfflineReady(false)}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  return null
}
