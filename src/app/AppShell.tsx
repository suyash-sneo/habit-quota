/**
 * The persistent frame: a narrow rail on laptop, a fixed bottom bar on mobile.
 *
 * Exactly three destinations. There is no Settings screen — timezone, week
 * start and streak rules live inside the habit and goal flows.
 */

import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useApp } from './providers.tsx'
import { DataIcon, HomeIcon, ThemeMark, TimelineIcon } from '../components/icons.tsx'
import { Toaster } from '../components/Toaster.tsx'
import { UpdatePrompt } from './update-prompt/UpdatePrompt.tsx'
import styles from './AppShell.module.css'

interface Destination {
  to: string
  label: string
  icon: (props: { size?: number }) => React.JSX.Element
}

export function AppShell({ selectedHabitId }: { selectedHabitId: string | null }): React.JSX.Element {
  const { settings, toggleTheme } = useApp()
  const location = useLocation()

  const habitBase = selectedHabitId ? `/habit/${selectedHabitId}` : '/'
  const destinations: Destination[] = [
    { to: habitBase, label: 'Home', icon: HomeIcon },
    { to: selectedHabitId ? `${habitBase}/timeline` : '/', label: 'Timeline', icon: TimelineIcon },
    { to: '/data', label: 'Data', icon: DataIcon },
  ]

  const isActive = (to: string): boolean => {
    if (to === '/data') return location.pathname.startsWith('/data')
    if (to.endsWith('/timeline')) return location.pathname.endsWith('/timeline')
    return location.pathname.startsWith('/habit') && !location.pathname.endsWith('/timeline')
  }

  const themeLabel = settings.theme === 'dark' ? 'Light mode' : 'Dark mode'

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>

      <aside className={styles.rail}>
        <div className={styles.wordmark}>Habits</div>
        <nav aria-label="Primary" style={{ display: 'contents' }}>
          {destinations.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={label}
              to={to}
              className={`${styles.railLink} ${isActive(to) ? styles.railLinkActive : ''}`}
              aria-current={isActive(to) ? 'page' : undefined}
            >
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.grow} />
        <button type="button" className={styles.themeButton} onClick={toggleTheme}>
          <ThemeMark />
          {themeLabel}
        </button>
      </aside>

      <main className={styles.main} id="main">
        <Outlet />
      </main>

      <nav className={styles.bar} aria-label="Primary">
        {destinations.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={label}
            to={to}
            className={`${styles.barLink} ${isActive(to) ? styles.barLinkActive : ''}`}
            aria-current={isActive(to) ? 'page' : undefined}
          >
            <Icon size={19} />
            <span className={styles.barLabel}>{label}</span>
            <span className={styles.barUnderline} />
          </NavLink>
        ))}
        <button type="button" className={styles.barLink} onClick={toggleTheme}>
          <ThemeMark size={17} />
          <span className={styles.barLabel}>{themeLabel.split(' ')[0]}</span>
          <span className={styles.barUnderline} />
        </button>
      </nav>

      <Toaster />
      <UpdatePrompt />
    </div>
  )
}
