# Testing

## Layers

| Layer | Where | What it covers |
| --- | --- | --- |
| Pure domain | `src/domain/**/*.test.ts` | Dates and zones, event DAG, projection, aggregation, streaks, heatmap, goals, canonical JSON and checksum, merge planning and resolution |
| Design tokens | `src/styles/tokens.test.ts` | WCAG AA contrast, recomputed from `tokens.css` |
| Database | `src/db/database.test.ts` | Atomic sequence allocation, duplicate rejection, projection rebuild, snapshots, import commit — against `fake-indexeddb` |
| Component | `src/features/**/*.test.tsx` | Each screen through real user interactions |
| Accessibility | `src/test/a11y/a11y.test.tsx` | axe-core on every screen, focus handling, accessible names |
| End-to-end | `tests/e2e/habits.spec.ts` | A production build served under `/habit-quota/`, in Chromium, WebKit and an iPhone viewport |

```bash
npm test            # everything except Playwright
npm run test:a11y   # accessibility only
npm run test:e2e    # Playwright (builds first)
```

## Notable invariants

Asserted directly, because they are the ones that would silently lose data:

- Importing the same backup twice is idempotent.
- The union of two logs is commutative before any local resolution.
- Projection output is independent of input order.
- A rebuild reproduces byte-identical views.
- No authoritative event is lost by conflict resolution.
- A failed write consumes no device sequence and leaves no partial projection.
- A failed import leaves the database logically unchanged.
- A private habit's real name never appears in any stored event.
- No screen scrolls sideways on a phone, and the heatmap scrolls on one axis.
- Every form control is at least 16px, so iOS Safari never zooms on focus.

## Known limits of the automated suite

- **Contrast** cannot be evaluated by axe under jsdom, which has no layout. It is
  covered instead by `tokens.test.ts`, which recomputes every foreground/background
  ratio from `tokens.css`.
- **Offline reload** is only driven in Chromium. Playwright's WebKit build errors
  out reloading a page under offline emulation, so iOS offline behaviour is on the
  manual checklist below.
- **Native date and time controls** are drawn by the platform, and headless
  WebKit draws them as ordinary text boxes. Their real width on iOS depends on
  the locale's date format and cannot be measured here, so the layout is built
  not to depend on it: below 560px every field takes the full width of its form.
  The tests assert that arrangement rather than the resulting pixels.
- **The File System Access picker** opens a native dialog no automated run can
  drive. The end-to-end test exercises the download fallback — the path iOS Safari
  and Firefox take — and the picker is checked by hand on desktop Chrome.

## iPhone acceptance checklist

Run on real hardware before a release. Nothing here is automatable.

- [ ] Open the Pages URL in Safari; the app loads and onboarding appears.
- [ ] Share → Add to Home Screen; the name and icon look right.
- [ ] Launch from the home screen; it opens standalone with no browser chrome.
- [ ] The bottom bar clears the home indicator, and the content clears the notch.
- [ ] Log an entry; today's figure, the heatmap cell, the streak, the week total
      and the goal all update at once.
- [ ] The heatmap scrolls horizontally, starts at the newest weeks, and does
      not scroll vertically.
- [ ] Day cells are comfortably tappable despite the small squares.
- [ ] Sheets open from the bottom and dismiss on tapping the scrim.
- [ ] The keyboard does not cover the field being typed into.
- [ ] Force-quit and reopen; the data is still there.
- [ ] Open the log sheet: the whole form, including Save, clears the browser's
      bottom toolbar, and the "minutes" label sits beside its input.
- [ ] On a negative habit, open the log sheet: the date and the time each have
      a full-width line and neither is cut off at the right edge.
- [ ] Tap the "?" beside a streak field; the explanation opens below the label,
      fully on screen, and dismisses.
- [ ] Tap into every text field in turn: the page never zooms, so it never has
      to be pinched back out afterwards.
- [ ] Swipe left and right anywhere except the heatmap: nothing moves.
- [ ] Tap days along the top and bottom edges of the heatmap; the day that
      opens is the one under the finger.
- [ ] Data → Start over deletes everything and lands on onboarding.
- [ ] Enable Airplane Mode and relaunch; the app opens and logging still works.
- [ ] Export a backup through the Files picker to iCloud Drive.
- [ ] Import that file on a second device; the preview counts look right and the
      merge restores the history.
- [ ] Re-import the same file; it reports that nothing would be added.
- [ ] VoiceOver: the habit title announces as a button; heatmap cells announce
      the date and value; week headers announce the range and total; sheets
      announce as dialogs and trap focus.
- [ ] At 200% text size nothing overlaps or is cut off.
- [ ] With Reduce Motion enabled nothing animates.
- [ ] Deploy an update; the prompt appears, "Later" dismisses it, and "Update
      now" is disabled while a form has unsaved work.
- [ ] After updating, the data is unchanged.

## Adding a test

Put it at the lowest layer that can express it. A rule about how a streak is
counted belongs in `src/domain/streaks`, not in a component test. Component tests
should go through what a user does — click the button, read the screen — rather
than reaching into state.

Fixtures live in `src/test/fixtures/`. Everything in them is invented: no real
habit data, no real device names, no real notes.
