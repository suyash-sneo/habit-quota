/**
 * App-wide context: settings, the current local date, the toast queue, and the
 * one-time startup sequence (device identity, projection freshness).
 *
 * Screens read data with `useLiveQuery` straight from Dexie; this provider only
 * owns things that are not rows in the database.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { ensureProjectionsCurrent, ensureThisDevice, getSettings, saveSettings } from '../db/database.ts'
import type { AppSettings, DeviceRow } from '../db/schema.ts'
import { DEFAULT_SETTINGS } from '../db/schema.ts'
import { deviceTimezone, todayInZone } from '../domain/time/zone.ts'
import type { LocalDate } from '../domain/time/civil.ts'

export interface ToastAction {
  label: string
  run: () => void | Promise<void>
}

export interface ToastMessage {
  id: number
  message: string
  action?: ToastAction
  tone: 'neutral' | 'bad'
}

export type BootState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'rebuilding' }
  | { status: 'failed'; error: Error }

interface AppContextValue {
  boot: BootState
  retryBoot: () => void
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  toggleTheme: () => void
  device: DeviceRow | null
  /** Today's local date in the configured timezone, kept current as the day turns. */
  today: LocalDate
  toasts: ToastMessage[]
  showToast: (message: string, options?: { action?: ToastAction; tone?: ToastMessage['tone'] }) => void
  dismissToast: (id: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside <AppProvider>')
  return value
}

/** Recomputes the local date when the clock crosses midnight or the tab wakes. */
function useToday(timezoneId: string): LocalDate {
  const [today, setToday] = useState<LocalDate>(() => todayInZone(timezoneId))

  useEffect(() => {
    const sync = (): void => {
      setToday((current) => {
        const next = todayInZone(timezoneId)
        return next === current ? current : next
      })
    }
    sync()
    const interval = window.setInterval(sync, 60_000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [timezoneId])

  return today
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' })
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    timezoneId: deviceTimezone(),
  }))
  const [device, setDevice] = useState<DeviceRow | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [attempt, setAttempt] = useState(0)
  const toastId = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function start(): Promise<void> {
      setBoot({ status: 'loading' })
      try {
        const deviceRow = await ensureThisDevice()
        if (cancelled) return
        setDevice(deviceRow)

        const stored = await getSettings()
        if (cancelled) return
        setSettings(stored)

        setBoot({ status: 'rebuilding' })
        await ensureProjectionsCurrent()
        if (cancelled) return
        setBoot({ status: 'ready' })
      } catch (error) {
        if (cancelled) return
        setBoot({ status: 'failed', error: error instanceof Error ? error : new Error(String(error)) })
      }
    }

    void start()
    return () => {
      cancelled = true
    }
  }, [attempt])

  const today = useToday(settings.timezoneId)

  // The theme lives on <html> so the page background matches before React paints.
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', settings.theme === 'dark' ? '#0e110f' : '#f5f7f9')
  }, [settings.theme])

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await saveSettings(patch)
    setSettings(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setSettings((current) => {
      const next: AppSettings = { ...current, theme: current.theme === 'dark' ? 'light' : 'dark' }
      void saveSettings({ theme: next.theme })
      return next
    })
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const showToast = useCallback<AppContextValue['showToast']>(
    (message, options) => {
      toastId.current += 1
      const id = toastId.current
      const toast: ToastMessage = {
        id,
        message,
        tone: options?.tone ?? 'neutral',
        ...(options?.action ? { action: options.action } : {}),
      }
      // One toast at a time: a new message replaces the previous one.
      setToasts([toast])
      window.setTimeout(() => dismissToast(id), options?.action ? 9000 : 5000)
    },
    [dismissToast],
  )

  const retryBoot = useCallback(() => setAttempt((n) => n + 1), [])

  const value = useMemo<AppContextValue>(
    () => ({
      boot,
      retryBoot,
      settings,
      updateSettings,
      toggleTheme,
      device,
      today,
      toasts,
      showToast,
      dismissToast,
    }),
    [boot, retryBoot, settings, updateSettings, toggleTheme, device, today, toasts, showToast, dismissToast],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
