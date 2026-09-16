/**
 * A generic, non-identifying name for this device.
 *
 * Derived only from the platform hint the browser already exposes — never from
 * anything about the person. "This Mac", not someone's name. The label travels
 * inside backups, so it must stay anonymous.
 */

export function defaultDeviceLabel(userAgent: string = navigator.userAgent): string {
  const ua = userAgent.toLowerCase()
  if (/iphone/.test(ua)) return 'This iPhone'
  if (/ipad/.test(ua)) return 'This iPad'
  // Modern iPads report as desktop Safari, so fall back on touch support.
  if (/macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) {
    return 'This iPad'
  }
  if (/macintosh|mac os x/.test(ua)) return 'This Mac'
  if (/android/.test(ua)) return /mobile/.test(ua) ? 'This Android phone' : 'This Android tablet'
  if (/windows/.test(ua)) return 'This Windows PC'
  if (/linux|x11|cros/.test(ua)) return 'This computer'
  return 'This device'
}
