/**
 * The rendered pixel width of an element.
 *
 * An SVG line chart needs real coordinates: scaling a viewBox to fit would
 * stretch the stroke and turn the point markers into ellipses. So the plot is
 * drawn at the width it actually occupies, and redrawn when that changes.
 *
 * `ResizeObserver` is absent in jsdom, so the fallback keeps the chart
 * renderable under test rather than collapsing it to nothing.
 */

import { useEffect, useRef, useState } from 'react'

export function useElementWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof ResizeObserver === 'undefined') {
      const measured = node.getBoundingClientRect().width
      if (measured > 0) setWidth(measured)
      return
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      if (measured > 0) setWidth(measured)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
