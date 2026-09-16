/**
 * A short explanation attached to a form field.
 *
 * Sighted users open it from the "?" button next to the label. Assistive tech
 * gets it unconditionally: the text stays in the accessibility tree even when
 * collapsed, so the field it describes always has a real description rather
 * than a hover-only hint that never reaches a touch screen.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './HelpTip.module.css'

export interface HelpTipProps {
  /** Id the described field points at with `aria-describedby`. */
  id: string
  /** What the explanation is about, used to name the button. */
  label: string
  children: ReactNode
}

export function HelpTip({ id, label, children }: HelpTipProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Close the tip without also closing the sheet it sits in.
      event.stopPropagation()
      setOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  return (
    <span className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What “${label}” means`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span id={id} role="note" className={open ? styles.panel : 'visuallyHidden'}>
        {children}
      </span>
    </span>
  )
}
