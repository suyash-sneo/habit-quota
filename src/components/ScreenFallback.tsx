/** Quiet placeholder while a lazy screen or the first database read resolves. */
export function ScreenFallback({ label }: { label: string }): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        fontSize: 13.5,
        color: 'var(--ink3)',
        fontFamily: 'var(--sans)',
      }}
    >
      {label}
    </div>
  )
}
