/**
 * Root component: router, provider, error boundary, and the recovery screen
 * shown when IndexedDB itself will not open.
 */

import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { HashRouter } from 'react-router-dom'
import { AppProvider, useApp } from './providers.tsx'
import { AppRoutes } from './routes.tsx'
import { RecoveryScreen } from '../features/onboarding/RecoveryScreen.tsx'

interface BoundaryState {
  error: Error | null
}

/**
 * Global boundary. Keeps the Data screen reachable so a user whose UI crashed
 * can still export before doing anything drastic.
 */
class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Local only. Nothing is ever sent anywhere.
    console.error('Habits crashed', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <RecoveryScreen
          title="Something went wrong on this screen"
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      )
    }
    return this.props.children
  }
}

function BootGate(): React.JSX.Element {
  const { boot, retryBoot } = useApp()
  if (boot.status === 'failed') {
    return (
      <RecoveryScreen
        title="Your local database would not open"
        error={boot.error}
        onRetry={retryBoot}
      />
    )
  }
  return <AppRoutes />
}

export function App(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppProvider>
          <BootGate />
        </AppProvider>
      </HashRouter>
    </ErrorBoundary>
  )
}
