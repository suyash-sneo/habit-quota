# Habits

A private, local-first habit tracker. One habit at a time, a contribution
heatmap, streaks, goals, and a complete change history — all stored in your own
browser, with no account and no server.

Data leaves the device only in a backup file you create yourself. Importing one
merges immutable events by identity, so nothing is ever overwritten.

---

## Contents

- [What it does](#what-it-does)
- [Running it locally](#running-it-locally)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [Installing on iPhone](#installing-on-iphone)
- [Backups and moving between devices](#backups-and-moving-between-devices)
- [How it is built](#how-it-is-built)
- [Testing](#testing)
- [Documentation](#documentation)
- [Deliberate deviations from the brief](#deliberate-deviations-from-the-brief)

---

## What it does

**Home** shows one selected habit: today's total, the current and longest streak,
a contribution heatmap, the selected day and week, and every active goal. The
large habit title *is* the habit switcher — there are no selector chips and no
Settings screen.

**Timeline** lists entries grouped by local date, and a Changes view showing the
immutable audit log: what was created, what was edited from what to what, what was
deleted, and what arrived from another device.

**Data** is application-wide: event count, coverage, sequence integrity, browser
storage status, export, and a merge preview that tells you exactly what an import
would add before anything is written. It also has **Start over**, which deletes
everything this browser holds and returns the app to its first run — useful
before restoring a backup from another device. It offers an export first and
asks you to type `delete` to confirm.

Four tracking models are supported — duration, completion, count, and negative
occurrence. A negative habit is treated differently throughout: a restrained
crimson mark rather than green intensity, "days since last event" rather than a
streak, and factual language about weekly limits rather than moralising. A habit
can be masked so that only the word **Private** is ever stored or shown.

---

## Running it locally

Requires Node 20.19+ (CI uses 22).

```bash
npm ci
npm run dev
```

In a development build the onboarding screen offers a synthetic demo-data
generator. It refuses to run in a production build, so it can never write
fabricated history into a real database.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build into `dist` |
| `npm run preview` | Serve the build (set `BASE_PATH` to match) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit, database, component and accessibility tests |
| `npm run test:a11y` | Accessibility tests only |
| `npm run test:e2e` | Playwright, against a production build |
| `npm run size` | Bundle budget report |

Previewing needs the same base the build used, or every asset 404s exactly as it
would on a misconfigured deployment:

```bash
BASE_PATH=/habit-quota/ npm run build
BASE_PATH=/habit-quota/ npm run preview
```

---

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. **Settings → Pages → Source**: choose **GitHub Actions**.
3. Confirm `BASE_PATH` in `.github/workflows/deploy-pages.yml`:
   - Project site (`https://USERNAME.github.io/habit-quota/`) → `/habit-quota/`
   - User site or custom domain → `/`
4. Push to `main`. The workflow type-checks, lints, tests, builds, checks the
   bundle budget, and deploys.

`BASE_PATH` is a build-time path, not a secret — it is bundled into asset URLs.
Every committed file, Actions log and bundled value in this repository is public.

Routing uses `HashRouter`, so GitHub Pages serves the same `index.html` for every
route and refreshing a deep link cannot 404.

> **Renaming the repository** changes the path but not the origin, so your data
> survives. **Moving to a custom domain changes the origin, and your data does
> not follow** — export first, then import on the new domain.

---

## Installing on iPhone

1. Open the Pages URL in Safari.
2. Share → **Add to Home Screen**.
3. Launch it from the home screen. It runs standalone, respects the safe areas,
   and works offline after the first load.

Exports go through the Files picker, so you can save a backup to iCloud Drive, and
import one from there on another device.

---

## Backups and moving between devices

Browser storage is not a backup. Clearing site data deletes everything, and some
browsers evict storage under pressure. The app asks for persistent storage once
you have data worth keeping and reports the answer plainly — a refusal is normal.

Export a JSON file from the Data screen whenever losing recent history would
hurt. To move to another device: export, open the app there, and import. The
preview shows how many events are already present, how many are new, and whether
anything conflicts. A pre-merge snapshot is taken automatically, and importing
the same file twice adds nothing.

Exported files are **readable text** containing your timestamps, values and
notes. See [`docs/privacy-and-threat-model.md`](docs/privacy-and-threat-model.md).

---

## How it is built

The event log is authoritative. Every user-meaningful change is an immutable
event; habits, entries, goals, totals and streaks are projections that can be
deleted and rebuilt at any time.

```
src/
  domain/      pure calculations — no React, no Dexie
    time/      civil dates, IANA zones, weeks, formatting
    events/    event types, validation, DAG heads, projection
    habits/    daily and weekly aggregation
    streaks/   positive streaks and negative intervals
    heatmap/   grid construction and intensity buckets
    goals/     goal evaluation
    backup/    canonical JSON, checksum, read and write
    merge/     import planning and conflict resolution
  db/          Dexie schema, repositories, projections, demo seed
  features/    screens composed from domain + persistence
  components/  shared primitives (sheet, toaster, icons)
  app/         router, providers, shell, update prompt
  workers/     import planning off the main thread
```

Domain modules import neither React nor Dexie. Repositories contain no visual
code. Screens compose the two.

| Concern | Choice |
| --- | --- |
| Language | TypeScript, strict, with `noUncheckedIndexedAccess` |
| UI | React 19 |
| Build | Vite |
| Routing | React Router, `HashRouter` |
| Storage | Dexie over IndexedDB |
| Reactivity | `dexie-react-hooks` |
| Validation | Zod |
| PWA | `vite-plugin-pwa`, prompt-based updates |
| Styling | CSS Modules plus global design tokens |
| Tests | Vitest, Testing Library, fake-indexeddb, Playwright, axe-core |

### On a phone

Three rules, each enforced by a test rather than left to care:

1. **One scroll direction.** The page moves down and only down. No screen is
   wider than the viewport, so the layout never has to be panned to find
   something that was visible a moment ago.
2. **One exception, on one axis.** The heatmap's week strip scrolls sideways,
   because a season of weeks genuinely does not fit across a phone. It does not
   scroll vertically — seven weekday rows always fit — and the Backup history
   table is the same deal.
3. **Zoom is never required.** Pinch-zoom stays enabled, because taking it away
   is taking away something people need. But nothing depends on it: no text
   below 12px, no target below 24px, and every form control at 16px — under
   that, iOS Safari zooms the page on focus and does not zoom back out, which is
   the usual reason a layout that fits ends up needing to be panned.

The visual design comes from the Claude Design source, and the tokens in
`src/styles/tokens.css` are taken from it verbatim. A test recomputes every
foreground/background pair's contrast ratio from that file, so a future colour
tweak that breaks WCAG AA fails the build.

---

## Testing

```bash
npm test              # 259 unit, database, component and a11y tests
npm run test:e2e      # Playwright: Chromium, WebKit, iPhone viewport
```

The end-to-end suite runs against a real production build served under
`/habit-quota/`, and covers onboarding, logging, editing with its consequence
preview, delete-and-undo, goals, export → fresh device → import → idempotent
re-import, offline launch, hash-route refresh, the manifest and icons, the CSP,
and that no request ever leaves the app's own origin. On the iPhone viewport it
also asserts the three rules above, screen by screen.

Some things only a person can check — see
[`docs/testing.md`](docs/testing.md) for the iPhone acceptance checklist.

---

## Documentation

- [`docs/event-model.md`](docs/event-model.md) — events, heads, conflicts,
  streaks, goals, and the invariants the tests enforce
- [`docs/backup-format.md`](docs/backup-format.md) — the file format, canonical
  JSON with worked vectors, checksum, and merge rules
- [`docs/privacy-and-threat-model.md`](docs/privacy-and-threat-model.md) — what
  is and is not protected
- [`docs/testing.md`](docs/testing.md) — test strategy and manual checklist
- [`docs/design-brief.md`](docs/design-brief.md) and
  [`docs/implementation-brief.md`](docs/implementation-brief.md) — the source
  briefs

---

## Deliberate deviations from the brief

Each of these trades a recommendation for something the brief also asks for.

**Temporal polyfill → a small `Intl`-based time module.** All historical dates
are already stored as `YYYY-MM-DD` labels, so the only real timezone work is
resolving "today" in a zone and converting a wall-clock time to an instant. Both
are exact with `Intl.DateTimeFormat`, which uses the platform's own tzdata.
`src/domain/time/` does the civil arithmetic with integer day numbers that cannot
be perturbed by DST, and the DST, midnight and boundary cases the brief lists are
all covered by tests. This keeps roughly 50 KB gzip out of the bundle.

**Radix primitives → one bespoke `Sheet`.** The design has exactly one overlay,
which is a bottom sheet on mobile and a centred modal on laptop purely through
CSS custom properties. A focused implementation matches that precisely and
carries modal semantics, a focus trap, Escape, and focus restoration; axe finds no
violations on any screen.

**`frame-ancestors` omitted from the CSP.** It is ignored in a `<meta>` policy.
Including it would look protective while doing nothing.

**Encrypted backups not implemented.** The brief lists them as recommended after
plaintext export and import are stable. The intended design is written down in
the privacy document, and the export sheet states plainly that the file is
plaintext rather than implying protection that does not exist.

**Boolean indexes are numeric mirrors.** IndexedDB cannot index a boolean, so
view rows carry `archivedFlag`, `deletedFlag` and `activeFlag` as 0/1 alongside
the authoritative booleans.

---

## Licence

MIT. See [LICENSE](LICENSE).
