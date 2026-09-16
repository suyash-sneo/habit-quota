/**
 * Hash routes.
 *
 * GitHub Pages serves the same index.html for every path before the `#`, so
 * refreshing `/habit-quota/#/habit/ID/timeline` cannot 404.
 */

import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AppShell } from './AppShell.tsx'
import { useApp } from './providers.tsx'
import { db, readMeta, writeMeta } from '../db/database.ts'
import { META_KEYS } from '../db/schema.ts'
import { HomeScreen } from '../features/home/HomeScreen.tsx'
import { TimelineScreen } from '../features/timeline/TimelineScreen.tsx'
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen.tsx'
import { ScreenFallback } from '../components/ScreenFallback.tsx'

// The Data screen pulls in import planning and conflict resolution, which the
// two everyday screens never need.
const DataScreen = lazy(async () => ({
  default: (await import('../features/data-transfer/DataScreen.tsx')).DataScreen,
}))

function useHabitIds(): { ids: string[] | undefined; loaded: boolean } {
  const rows = useLiveQuery(async () => {
    const habits = await db().habitViews.orderBy('sortOrder').toArray()
    return habits.filter((h) => !h.archived).map((h) => h.habitId)
  }, [])
  return { ids: rows, loaded: rows !== undefined }
}

/** Sends a brand-new user to onboarding and everyone else to their last habit. */
function HabitRedirect(): React.JSX.Element {
  const { ids, loaded } = useHabitIds()
  const remembered = useLiveQuery(
    async () => (await readMeta<string>(META_KEYS.lastSelectedHabitId)) ?? null,
    [],
    undefined,
  )

  if (!loaded || remembered === undefined) return <ScreenFallback label="Opening your habits…" />
  if (!ids || ids.length === 0) return <Navigate to="/onboarding" replace />

  const target = remembered && ids.includes(remembered) ? remembered : (ids[0] as string)
  return <Navigate to={`/habit/${target}`} replace />
}

/** Resolves `:habitId`, remembers it, and falls back when it is gone or archived. */
function HabitLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { habitId } = useParams<{ habitId: string }>()
  const { ids, loaded } = useHabitIds()

  useEffect(() => {
    if (!habitId || !ids?.includes(habitId)) return
    void writeMeta(META_KEYS.lastSelectedHabitId, habitId)
  }, [habitId, ids])

  if (!loaded) return <ScreenFallback label="Opening your habits…" />
  if (!ids || ids.length === 0) return <Navigate to="/onboarding" replace />
  if (!habitId || !ids.includes(habitId)) return <Navigate to={`/habit/${ids[0] as string}`} replace />

  return <>{children}</>
}

function ShellRoute(): React.JSX.Element {
  const { habitId } = useParams<{ habitId: string }>()
  const remembered = useLiveQuery(
    async () => (await readMeta<string>(META_KEYS.lastSelectedHabitId)) ?? null,
    [],
    null,
  )
  return <AppShell selectedHabitId={habitId ?? remembered ?? null} />
}

export function AppRoutes(): React.JSX.Element {
  const { boot } = useApp()

  if (boot.status === 'loading') return <ScreenFallback label="Opening your local database…" />
  if (boot.status === 'rebuilding') return <ScreenFallback label="Rebuilding your views…" />

  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingScreen />} />
      <Route element={<ShellRoute />}>
        <Route path="/" element={<HabitRedirect />} />
        <Route
          path="/habit/:habitId"
          element={
            <HabitLayout>
              <HomeScreen />
            </HabitLayout>
          }
        />
        <Route
          path="/habit/:habitId/timeline"
          element={
            <HabitLayout>
              <TimelineScreen />
            </HabitLayout>
          }
        />
        <Route
          path="/data"
          element={
            <Suspense fallback={<ScreenFallback label="Loading data tools…" />}>
              <DataScreen />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
