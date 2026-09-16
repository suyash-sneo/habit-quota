import { describe, expect, it } from 'vitest'
import { defaultDeviceLabel } from './device-label.ts'

describe('default device label', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'This iPhone'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'This iPad'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'This Mac'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile', 'This Android phone'],
    ['Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit/537.36', 'This Android tablet'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'This Windows PC'],
    ['Mozilla/5.0 (X11; Fedora; Linux x86_64) Gecko/20100101', 'This computer'],
    ['something entirely unfamiliar', 'This device'],
  ])('names %s as %s', (userAgent, expected) => {
    expect(defaultDeviceLabel(userAgent)).toBe(expected)
  })

  it('never contains anything about the person', () => {
    // Every branch is a fixed string; nothing is interpolated from the UA.
    const labels = [
      'Mozilla/5.0 (iPhone; Owner Jane Doe) AppleWebKit',
      'Mozilla/5.0 (Macintosh; jane-macbook) AppleWebKit',
    ].map((ua) => defaultDeviceLabel(ua))
    for (const label of labels) {
      expect(label).toMatch(/^This /)
      expect(label.toLowerCase()).not.toContain('jane')
    }
  })
})
