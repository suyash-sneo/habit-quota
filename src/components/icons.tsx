/**
 * Inline SVG marks, copied from the design source. All are decorative — the
 * label beside them carries the meaning.
 */

export function HomeIcon({ size = 17 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2 7.2 8 2.2l6 5V14H10V9.6H6V14H2z" fill="currentColor" />
    </svg>
  )
}

export function TimelineIcon({ size = 17 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2" y="6" width="2.4" height="8" fill="currentColor" />
      <rect x="6.8" y="2" width="2.4" height="12" fill="currentColor" />
      <rect x="11.6" y="8.5" width="2.4" height="5.5" fill="currentColor" />
    </svg>
  )
}

export function DataIcon({ size = 17 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M1.5 11.5 5.5 6l3 2.6L14.5 3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function LockIcon({ height = 16 }: { height?: number | string }): React.JSX.Element {
  const width = typeof height === 'number' ? (height * 14) / 17 : `calc(${height} * 14 / 17)`
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 14 17"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      <rect x="1" y="7" width="12" height="9" rx="2" fill="currentColor" />
      <path d="M3.6 7V4.8a3.4 3.4 0 0 1 6.8 0V7" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export function ChevronDown(): React.JSX.Element {
  return (
    <svg
      width="0.4em"
      height="0.28em"
      viewBox="0 0 18 11"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto', opacity: 0.75 }}
    >
      <path d="M1.5 1.8 9 8.6l7.5-6.8" fill="none" stroke="currentColor" strokeWidth="2.1" />
    </svg>
  )
}

export function ThemeMark({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1.5px solid currentColor',
        background: 'linear-gradient(90deg, currentColor 50%, transparent 50%)',
        flex: '0 0 auto',
      }}
    />
  )
}
