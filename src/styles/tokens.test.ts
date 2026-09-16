/**
 * Contrast regression guard for the design tokens.
 *
 * jsdom cannot run axe's `color-contrast` rule, so the palette is checked here
 * directly: the ratios are computed from `tokens.css` itself, meaning a future
 * colour tweak that breaks WCAG AA fails the build rather than shipping.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Read from the project root: under jsdom `import.meta.url` is an http URL.
const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

function paletteFor(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  expect(start, `${selector} block missing from tokens.css`).toBeGreaterThan(-1)
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const palette: Record<string, string> = {}
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    palette[match[1] as string] = (match[2] as string).toLowerCase()
  }
  return palette
}

function relativeLuminance(hex: string): number {
  const channel = (pair: string): number => {
    const value = parseInt(pair, 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const r = channel(hex.slice(1, 3))
  const g = channel(hex.slice(3, 5))
  const b = channel(hex.slice(5, 7))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (high + 0.05) / (low + 0.05)
}

/** Foreground/background pairs the interface actually puts together. */
const TEXT_PAIRS: Array<[fg: string, bg: string]> = [
  ['ink', 'bg'],
  ['ink', 'surf'],
  ['ink', 'surf2'],
  ['ink', 'surf3'],
  ['ink2', 'bg'],
  ['ink2', 'surf'],
  ['ink2', 'surf2'],
  ['ink3', 'bg'],
  ['ink3', 'surf'],
  ['ink3', 'surf2'],
  ['grnInk', 'surf'],
  ['grnInk', 'surf3'],
  ['grnInk', 'grnSoft'],
  ['onGrn', 'grn'],
  ['crimInk', 'surf'],
  ['crimInk', 'crimSoft'],
  ['ambInk', 'surf'],
  ['ambInk', 'ambSoft'],
]

const THEMES: Array<[name: string, selector: string]> = [
  ['dark', ':root {'],
  ['light', "[data-theme='light'] {"],
]

describe('design tokens', () => {
  for (const [themeName, selector] of THEMES) {
    describe(themeName, () => {
      const palette = paletteFor(selector)

      it.each(TEXT_PAIRS)('%s on %s meets WCAG AA for body text', (fg, bg) => {
        const foreground = palette[fg]
        const background = palette[bg]
        expect(foreground, `--${fg} missing`).toBeDefined()
        expect(background, `--${bg} missing`).toBeDefined()
        expect(contrastRatio(foreground as string, background as string)).toBeGreaterThanOrEqual(4.5)
      })

      it('keeps the heatmap ramp monotonic and well separated end to end', () => {
        const ramp = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'].map((key) => palette[key] as string)
        expect(ramp.every(Boolean)).toBe(true)
        expect(new Set(ramp).size).toBe(ramp.length)

        // Intensity must read in one direction, so a darker/lighter cell always
        // means less/more. Colour alone never carries the value: each cell's
        // accessible name states it, and the legend is always on screen.
        const luminances = ramp.map(relativeLuminance)
        const ascending = (luminances[5] as number) > (luminances[0] as number)
        for (let i = 1; i < luminances.length; i += 1) {
          const previous = luminances[i - 1] as number
          const current = luminances[i] as number
          expect(ascending ? current > previous : current < previous).toBe(true)
        }
        expect(contrastRatio(ramp[0] as string, ramp[5] as string)).toBeGreaterThan(4)
      })

      it('keeps the negative-event mark distinct from the positive ramp', () => {
        expect(contrastRatio(palette.crim as string, palette.g3 as string)).toBeGreaterThan(1.2)
      })
    })
  }

  it('defines a light override for every colour the dark theme defines', () => {
    const dark = paletteFor(':root {')
    const light = paletteFor("[data-theme='light'] {")
    for (const key of Object.keys(dark)) {
      expect(light[key], `--${key} has no light-theme value`).toBeDefined()
    }
  })
})
