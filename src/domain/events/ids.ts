/**
 * Identifier generation. UUIDv4 via Web Crypto, with a `getRandomValues`
 * fallback for Safari versions that predate `randomUUID`.
 *
 * Nothing in the domain depends on UUID ordering.
 */

const HEX: string[] = Array.from({ length: 256 }, (_, i) => (i + 0x100).toString(16).slice(1))

export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16))
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
    const h = (i: number): string => HEX[bytes[i] as number] as string
    return (
      `${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-` +
      `${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
    )
  }
  throw new Error('This browser does not expose Web Crypto, which the app requires.')
}
