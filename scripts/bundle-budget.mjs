/**
 * Bundle budget report.
 *
 * Fonts are measured but excluded from the JavaScript budget, exactly as the
 * implementation brief specifies. Exits non-zero when a budget is exceeded so
 * CI fails rather than quietly shipping a heavier app.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'

/** Gzipped kilobyte budgets. Fonts are reported, not budgeted. */
const BUDGETS = {
  js: 250,
  css: 50,
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

function gzipKb(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length / 1024
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`No ${DIST} directory. Run \`npm run build\` first.`)
  process.exit(1)
}

const totals = { js: 0, css: 0, font: 0, other: 0 }
const rows = []

for (const path of files) {
  const size = gzipKb(path)
  // The service worker and its workbox runtime ship separately from the app
  // shell and are not part of the first-load JavaScript the user waits on.
  const isServiceWorker = /(^|\/)(sw|workbox-[^/]+)\.js$/.test(path)
  const kind = path.endsWith('.js')
    ? isServiceWorker
      ? 'other'
      : 'js'
    : path.endsWith('.css')
      ? 'css'
      : path.endsWith('.woff2')
        ? 'font'
        : 'other'
  totals[kind] += size
  if (kind !== 'other') rows.push({ path, kind, size })
}

rows.sort((a, b) => b.size - a.size)

console.log('Gzipped sizes\n')
for (const row of rows) {
  console.log(`  ${row.size.toFixed(1).padStart(7)} KB  ${row.kind.padEnd(4)}  ${row.path}`)
}

console.log('\nTotals (gzipped)')
console.log(`  JavaScript  ${totals.js.toFixed(1)} KB  (budget ${BUDGETS.js} KB)`)
console.log(`  CSS         ${totals.css.toFixed(1)} KB  (budget ${BUDGETS.css} KB)`)
console.log(`  Fonts       ${totals.font.toFixed(1)} KB  (measured, not budgeted)`)

const failures = []
if (totals.js > BUDGETS.js) failures.push(`JavaScript ${totals.js.toFixed(1)} KB > ${BUDGETS.js} KB`)
if (totals.css > BUDGETS.css) failures.push(`CSS ${totals.css.toFixed(1)} KB > ${BUDGETS.css} KB`)

if (failures.length) {
  console.error(`\nOver budget:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nWithin budget.')
