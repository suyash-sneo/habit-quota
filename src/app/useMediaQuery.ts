import { useSyncExternalStore } from 'react'

/** Live media-query match, so layout-dependent counts follow a resize. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** True at the width where the app switches to the bottom bar and sheets. */
export function useIsNarrow(): boolean {
  return useMediaQuery('(max-width: 920px)')
}
