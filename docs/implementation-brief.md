# Habit Tracker — Full Implementation Brief

## 1. Purpose of this document

Implement the habit tracker described in habit-tracker-design-brief.md as a responsive, installable, local-first web application.

The production application must:

- Be hosted on GitHub Pages.
- Live in a public GitHub repository.
- Run entirely as static HTML, CSS, JavaScript, fonts, icons, and PWA assets.
- Require no backend, account, API key, paid service, or server-side function.
- Store personal data only in the user's browser.
- Work well as an installed iPhone PWA and as a laptop web application.
- Continue working offline after the first successful load.
- Export and import portable backups.
- Merge backups by immutable event identity rather than overwriting the local database.
- Preserve a complete user-visible change history.

The design brief remains authoritative for product behavior and visual intent. This implementation brief is authoritative for architecture, persistence, algorithms, deployment, testing, and delivery.

---

## 2. Non-negotiable platform constraints

### 2.1 GitHub Pages is static hosting

GitHub Pages serves the built application only. It cannot receive writes or persist user data. Do not implement server endpoints, server actions, SSR, cookies, authentication callbacks, or any feature that assumes a writable server.

All runtime writes go to IndexedDB in the current browser origin.

### 2.2 The repository is public

Assume every committed file, build script, GitHub Actions log, source map, and bundled environment value is public.

Therefore:

- Never commit real habit data.
- Never commit exported backups.
- Never commit personal device names in fixtures.
- Never commit tokens, passwords, private keys, encryption keys, or service credentials.
- Never treat Vite environment variables as secret.
- Do not embed a GitHub personal access token in the application.
- Do not attempt to use a GitHub repository or Gist as a writable database from browser code.
- Use synthetic test fixtures only.
- Add backup filename patterns to .gitignore.

The public source code does not expose IndexedDB data. User data exists only in the browser profile and in backup files explicitly created by the user.

### 2.3 Origin behavior matters

IndexedDB is scoped to an origin, not to a GitHub repository.

- Project Pages at https://USERNAME.github.io/REPOSITORY/ use the origin https://USERNAME.github.io.
- Other project sites under the same GitHub Pages hostname share that origin, although this application uses a unique database name.
- Renaming the repository changes the path but not necessarily the origin; the database remains available if the hostname and database name stay unchanged.
- Moving to a custom domain changes the origin. Data does not automatically follow.
- Moving between github.io and a custom domain requires export from the old origin and import into the new origin.

Use a stable, application-specific IndexedDB name such as habit-tracker-local-v1. Do not derive the database name from the repository path.

### 2.4 Browser storage is not a backup

IndexedDB is persistent browser storage, but users can clear site data and browsers can apply storage policies. After the user creates their first habit or entry:

- Call navigator.storage.persist() when supported.
- Treat a false or unsupported result as normal.
- Show storage status on the Data screen without alarming language.
- Continue prompting for periodic exports because persistence is never a substitute for a separate backup.

---

## 3. Recommended technology stack

Pin exact dependency versions in package-lock.json when the repository is initialized. Do not use unpinned CDN scripts.

| Concern | Choice | Reason |
| --- | --- | --- |
| Language | TypeScript with strict mode | Domain and event correctness |
| UI | React | Mature responsive component model |
| Build | Vite | Static build and first-class GitHub Pages guidance |
| Routing | React Router with HashRouter | Deep navigation without Pages rewrite support |
| Local database | Dexie over IndexedDB | Transactions, indexes, migrations, reactive queries |
| Reactive DB bindings | dexie-react-hooks | Rerender from local database changes |
| Runtime validation | Zod | Validate forms, database payloads, and imported backups |
| Time calculations | Temporal polyfill plus Intl formatting | Explicit local dates, zones, week boundaries, and DST |
| PWA | vite-plugin-pwa | Manifest and service-worker generation |
| Accessible overlays | Radix primitives or equivalent headless primitives | Dialog, popover, menu, tooltip, focus handling |
| Styling | CSS Modules plus global design tokens | Precise custom UI without utility-class clutter |
| Unit tests | Vitest | Fast TypeScript tests |
| Component tests | React Testing Library | User-facing interaction tests |
| IndexedDB tests | fake-indexeddb | Deterministic storage tests |
| End-to-end tests | Playwright, including WebKit | iPhone/Safari-oriented coverage |
| Accessibility tests | axe-core integration | Automated baseline checks |

Do not add Redux, Zustand, TanStack Query, a charting library, or a component theme framework unless a concrete need appears. IndexedDB is the application state source; React local state is sufficient for transient UI.

The contribution heatmap must be a custom semantic grid, not a generic chart-library component.

---

## 4. Repository layout

Use one application repository with the following structure:

    .
    ├── .github/
    │   └── workflows/
    │       ├── ci.yml
    │       └── deploy-pages.yml
    ├── docs/
    │   ├── design-brief.md
    │   ├── implementation-brief.md
    │   ├── backup-format.md
    │   └── event-model.md
    ├── public/
    │   ├── icons/
    │   ├── maskable-icons/
    │   ├── favicon.svg
    │   └── .nojekyll
    ├── src/
    │   ├── app/
    │   │   ├── App.tsx
    │   │   ├── AppShell.tsx
    │   │   ├── routes.tsx
    │   │   ├── providers.tsx
    │   │   └── update-prompt/
    │   ├── components/
    │   │   ├── buttons/
    │   │   ├── dialog/
    │   │   ├── menu/
    │   │   ├── navigation/
    │   │   └── typography/
    │   ├── domain/
    │   │   ├── events/
    │   │   ├── habits/
    │   │   ├── goals/
    │   │   ├── heatmap/
    │   │   ├── streaks/
    │   │   ├── time/
    │   │   ├── merge/
    │   │   └── backup/
    │   ├── db/
    │   │   ├── database.ts
    │   │   ├── schema.ts
    │   │   ├── repositories/
    │   │   ├── projections/
    │   │   ├── migrations/
    │   │   └── seed.ts
    │   ├── features/
    │   │   ├── habit-selector/
    │   │   ├── home/
    │   │   ├── heatmap/
    │   │   ├── entry-editor/
    │   │   ├── goals/
    │   │   ├── timeline/
    │   │   ├── data-transfer/
    │   │   ├── conflict-resolution/
    │   │   └── onboarding/
    │   ├── workers/
    │   │   └── import-worker.ts
    │   ├── styles/
    │   │   ├── tokens.css
    │   │   ├── reset.css
    │   │   └── global.css
    │   ├── test/
    │   │   ├── fixtures/
    │   │   └── setup.ts
    │   └── main.tsx
    ├── tests/
    │   └── e2e/
    ├── index.html
    ├── package.json
    ├── package-lock.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── vitest.config.ts
    └── playwright.config.ts

Rules:

- Domain modules contain pure calculations and no React or IndexedDB imports.
- Database repositories contain persistence logic and no visual code.
- Features compose domain and persistence APIs into screens.
- Shared components know nothing about habit calculations.
- Tests mirror this separation.

---

## 5. Routing and GitHub Pages base path

### 5.1 Use hash routing

Use HashRouter so URLs remain compatible with a static host:

    /REPOSITORY/#/habit/HABIT_ID
    /REPOSITORY/#/habit/HABIT_ID/timeline
    /REPOSITORY/#/data
    /REPOSITORY/#/onboarding

GitHub Pages always serves the same index.html before the hash, so refreshing a route does not produce a server 404.

Do not use BrowserRouter unless a tested 404 fallback is deliberately added later.

### 5.2 Configure the Vite base

The production base depends on the Pages URL:

- User or organization site, or custom domain: /
- Project site: /REPOSITORY/

Read the base from a build-time BASE_PATH value consumed only by vite.config.ts. BASE_PATH is not a secret.

Conceptual configuration:

    import { defineConfig } from 'vite'
    import react from '@vitejs/plugin-react'
    import { VitePWA } from 'vite-plugin-pwa'

    const base = process.env.BASE_PATH || '/'

    export default defineConfig({
      base,
      plugins: [
        react(),
        VitePWA({
          registerType: 'prompt',
          manifest: {
            name: 'Habits',
            short_name: 'Habits',
            display: 'standalone',
            start_url: base,
            scope: base,
            theme_color: '#101615',
            background_color: '#101615'
          }
        })
      ]
    })

The repository name must not be duplicated in asset URLs. Never write absolute asset paths by hand. Use imported assets, import.meta.env.BASE_URL, or Vite-managed public paths.

### 5.3 Selected habit persistence

The selected habit ID is present in the hash route and also retained in metadata as lastSelectedHabitId.

Behavior:

- Direct route to an existing habit selects it.
- Missing or archived ID falls back to the first active habit.
- A new user is redirected to onboarding.
- Selecting a habit updates the route without reloading.
- Moving between Home and Timeline preserves the selected habit.

---

## 6. GitHub Pages deployment

### 6.1 Repository configuration

1. Create a public GitHub repository.
2. Use main as the protected default branch.
3. In Repository Settings → Pages, choose GitHub Actions as the source.
4. Enable HTTPS.
5. Configure the workflow's BASE_PATH:
   - /REPOSITORY/ for a project site.
   - / for a user site or custom domain.

### 6.2 Deployment workflow

The deployment workflow must:

- Run on pushes to main and manual dispatch.
- Install with npm ci.
- Run type checking, unit tests, and a production build.
- Upload only dist.
- Deploy with the official Pages actions.
- Grant contents: read, pages: write, and id-token: write.
- Use a github-pages concurrency group.

Use the current official action majors from the Vite/GitHub Pages templates when creating the repository. A representative workflow is:

    name: Deploy to GitHub Pages

    on:
      push:
        branches: [main]
      workflow_dispatch:

    permissions:
      contents: read
      pages: write
      id-token: write

    concurrency:
      group: pages
      cancel-in-progress: true

    jobs:
      deploy:
        environment:
          name: github-pages
        runs-on: ubuntu-latest
        steps:
          - uses: actions/checkout@v7
          - uses: actions/setup-node@v7
            with:
              node-version: 22
              cache: npm
          - run: npm ci
          - run: npm run typecheck
          - run: npm test -- --run
          - run: npm run build
            env:
              BASE_PATH: /REPOSITORY/
          - uses: actions/configure-pages@v6
          - uses: actions/upload-pages-artifact@v5
            with:
              path: dist
          - id: deployment
            uses: actions/deploy-pages@v5

Replace REPOSITORY with the actual repository name. If GitHub's current official template uses newer action majors when implementation begins, use those instead and keep the lockfile/toolchain tested.

### 6.3 Pull-request CI

Run a separate CI workflow on pull requests:

- npm ci
- typecheck
- lint
- unit tests
- component tests
- build with the production base path
- Playwright smoke tests against the built preview

Do not deploy pull requests to the production Pages environment.

---

## 7. Public-repository hygiene

Include at minimum:

    node_modules/
    dist/
    coverage/
    playwright-report/
    test-results/
    *.habitbak
    habit-backup*.json
    private-backup*.json
    .env
    .env.*
    !.env.example

Additional rules:

- Do not put real backups under public, fixtures, or docs.
- A demo dataset must use fictional dates, notes, and device labels.
- Use This iPhone and This Mac in UI fixtures, not a real person's name.
- Include a LICENSE appropriate for a public repository.
- Commit package-lock.json.
- Enable Dependabot for npm and GitHub Actions.
- Prefer pinned action SHAs if the maintainer is comfortable updating them; otherwise use current official major tags.
- Do not upload source maps containing personal data. Source maps contain source code only and are acceptable, but production source maps may be disabled to reduce artifact size.

---

## 8. PWA and offline behavior

### 8.1 App shell

Precache:

- index.html
- hashed JavaScript and CSS bundles
- local fonts
- icons
- manifest
- static illustrations, if any

Do not cache:

- User-selected backup files.
- Blob download URLs.
- Any future third-party network response by default.

The first successful online load installs the service worker. Subsequent launches must render the full application offline.

### 8.2 Update flow

Use a prompt-based update strategy:

- When a new service worker is waiting, show New version available.
- Provide Update now and Later.
- Before reloading, finish any open IndexedDB transaction and warn if an unsaved form is dirty.
- Never silently reload in the middle of entry editing or import resolution.

Database schema migrations run before the updated UI becomes interactive. Display a focused recovery screen if migration fails.

### 8.3 Installability

Provide:

- 192 × 192 and 512 × 512 icons.
- Maskable variants.
- Apple touch icon.
- Standalone display.
- Matching theme/background colors.
- A short app name that fits the iOS home screen.

Do not block use behind an install prompt. The browser version and installed PWA are the same application.

---

## 9. Storage architecture

### 9.1 Event log is authoritative

All user-meaningful changes are immutable events. Current rows, daily totals, goal progress, and streaks are projections that can be rebuilt.

Do not store current streak as authoritative data.
Do not update or delete an old event in place.
Do not use timestamps to silently choose between conflicting device edits.

### 9.2 Rebuildable projections

Maintain projection tables for fast screens:

- habitViews
- goalViews
- entryViews
- entityHeads
- optional dayAggregates

Every projection has a projectionVersion. When projection logic changes:

1. Increment projectionVersion.
2. Clear only projection tables.
3. Replay authoritative events in deterministic order.
4. Leave events untouched.

### 9.3 Non-event metadata

The following may be mutable metadata because it is device-local operational state, not user history:

- Current device ID and display label.
- Next local device sequence.
- Last selected habit.
- Projection version.
- PWA update flags.
- Storage persistence result.
- Locally recorded export history.

---

## 10. IndexedDB schema

Use a Dexie database named habit-tracker-local-v1.

Suggested tables and indexes:

    events:
      &eventId,
      entityId,
      habitId,
      eventType,
      recordedAt,
      occurredLocalDate,
      [deviceId+deviceSequence],
      *parentEventIds

    habitViews:
      &habitId,
      sortOrder,
      archived

    goalViews:
      &goalId,
      habitId,
      active,
      [habitId+active]

    entryViews:
      &entryId,
      habitId,
      occurredLocalDate,
      deleted,
      [habitId+occurredLocalDate]

    entityHeads:
      &entityId,
      entityType,
      habitId

    devices:
      &deviceId

    imports:
      &importId,
      importedAt,
      backupId

    snapshots:
      &snapshotId,
      createdAt

    meta:
      &key

Store parentEventIds as an array. Normal edits have one parent. A conflict-resolution event can have two or more parents, like a merge commit.

Index only fields used by actual queries. Do not index notes or payload blobs.

---

## 11. Core TypeScript model

### 11.1 Identifiers

Use crypto.randomUUID() for:

- eventId
- entityId
- habitId
- goalId
- backupId
- importId
- snapshotId
- deviceId

Ordering does not depend on UUID order.

### 11.2 Base event

    type EventType =
      | 'habit.created'
      | 'habit.updated'
      | 'habit.reordered'
      | 'habit.archived'
      | 'habit.restored'
      | 'goal.created'
      | 'goal.updated'
      | 'goal.deleted'
      | 'entry.created'
      | 'entry.updated'
      | 'entry.deleted'
      | 'entry.restored'
      | 'conflict.resolved'
      | 'system.imported'

    interface DomainEvent<TPayload = unknown> {
      schemaVersion: 1
      eventId: string
      entityId: string
      entityType: 'habit' | 'goal' | 'entry' | 'system'
      habitId?: string
      eventType: EventType
      parentEventIds: string[]
      deviceId: string
      deviceSequence: number
      recordedAt: string
      occurredAt?: string
      occurredLocalDate?: string
      timezoneId?: string
      payload: TPayload
    }

recordedAt is an RFC 3339 UTC instant.
occurredAt is the exact instant when one exists.
occurredLocalDate is the preserved local date used for daily grouping.
timezoneId is an IANA zone such as America/Los_Angeles.

Never derive a historical local date again from the current device timezone. Preserve the local date and zone chosen at entry time.

### 11.3 Habit

    type TrackingModel =
      | 'duration'
      | 'completion'
      | 'count'
      | 'negative-occurrence'

    interface HabitSnapshot {
      habitId: string
      displayName: string
      trackingModel: TrackingModel
      unit: 'minutes' | 'sessions' | 'count' | 'events'
      isPrivate: boolean
      sortOrder: number
      archived: boolean
      createdLocalDate: string
    }

For a private habit, store displayName as Private. Do not store the sensitive real-world name in another hidden field.

### 11.4 Entry

    interface EntrySnapshot {
      entryId: string
      habitId: string
      occurredAt?: string
      occurredLocalDate: string
      timezoneId: string
      value: number
      unit: 'minutes' | 'sessions' | 'count' | 'events'
      startTime?: string
      endTime?: string
      note?: string
      sourceEntryId?: string
      deleted: boolean
    }

Rules:

- Duration value is an integer number of minutes.
- Completion uses value 1 for each intentional session.
- Negative occurrence uses value 1.
- Multiple entries may share a date.
- Notes are optional and plain text.
- No HTML is stored in notes.

### 11.5 Goal

    type GoalType =
      | 'cumulative-by-deadline'
      | 'periodic-minimum'
      | 'periodic-maximum'
      | 'streak'

    interface GoalSnapshot {
      goalId: string
      habitId: string
      goalType: GoalType
      metric: 'duration-minutes' | 'completion-count' | 'occurrence-count'
      targetValue: number
      period?: 'day' | 'week' | 'month' | 'year'
      deadlineLocalDate?: string
      effectiveFromLocalDate: string
      effectiveToLocalDate?: string
      timezoneId: string
      weekStartsOn: 1 | 2 | 3 | 4 | 5 | 6 | 7
      active: boolean
    }

Represent Monday as 1 through Sunday as 7. Validate all goal combinations with a discriminated Zod schema.

---

## 12. Atomic event creation

Every locally created event must receive a device sequence inside the same Dexie read-write transaction that stores the event.

Conceptual algorithm:

    transaction(events, meta, projection tables):
      device = read current device metadata
      sequence = device.nextSequence
      build event with deviceSequence = sequence
      verify event schema
      add event; fail if eventId already exists
      increment nextSequence
      apply event to projections
      commit

If any step fails, no sequence is consumed and no projection is partially updated.

recordedAt comes from the device clock, but cross-device conflict resolution never trusts clock ordering. deviceSequence establishes order only within one device.

---

## 13. Projection rules

### 13.1 Entity heads

For each entity:

- A root event has no parents.
- A normal edit replaces one known head and names it as its parent.
- A delete is a new head; it does not erase history.
- A restore is another event following a delete.
- A merged resolution names all conflicting heads as parents.

Current head calculation:

1. Collect every event for the entity.
2. Start with every event ID.
3. Remove every event ID that appears in another event's parentEventIds.
4. Remaining IDs are heads.
5. One head means resolved.
6. More than one head means a conflict.

### 13.2 Current entry projection

- One nondeleted head: show its snapshot.
- One deleted head: hide from normal totals, retain in Changes.
- Several heads: mark conflicted and exclude surprising automatic resolution.
- A conflict-resolution head: show its chosen merged snapshot.

### 13.3 Projection ordering

Replay events deterministically:

1. Satisfy parent dependencies first.
2. Within independent events, sort by recordedAt, then deviceId, then deviceSequence, then eventId.

This order is for deterministic presentation and rebuilding, not for choosing conflict winners.

---

## 14. Timezone and calendar implementation

Use the Temporal polyfill for domain calculations and Intl.DateTimeFormat for display.

### 14.1 Stored time values

For an entry:

- recordedAt: UTC instant when the record event was created.
- occurredAt: UTC instant when the activity occurred, if the user supplied time.
- occurredLocalDate: date selected by the user in the habit timezone.
- timezoneId: IANA timezone used for grouping.

For date-only historical imports, occurredAt may be absent. occurredLocalDate remains authoritative for the heatmap and quota.

### 14.2 Global time rules

The initial application has one active timezone and one week-start rule shared by habits, but each goal/event preserves the values that applied when it was created.

Default timezone:

    Intl.DateTimeFormat().resolvedOptions().timeZone

Default week start:

    Monday

The user confirms these during onboarding. They can edit time rules through the habit/goal management flow; there is no Settings page.

### 14.3 Required date tests

Test at least:

- America/Los_Angeles spring DST transition.
- America/Los_Angeles fall DST transition.
- Entry around local midnight.
- UTC day different from local day.
- Monday week boundary.
- Month and year boundary.
- Leap day.
- December 31 deadline.
- Timezone change after historical entries exist.

---

## 15. Aggregation algorithms

All calculation functions must be pure and tested independently of React and Dexie.

### 15.1 Daily aggregation

For a habit and local date:

- Select current, nondeleted, nonconflicted entries.
- Match habitId and occurredLocalDate.
- Duration: sum minutes.
- Completion: count sessions.
- Count: sum values.
- Negative occurrence: count events.

Return both the aggregate and contributing entry IDs.

### 15.2 Heatmap

Generate a rectangular range aligned to configured week boundaries.

Each cell contains:

- localDate
- isFuture
- isToday
- aggregateValue
- entryCount
- intensityBucket
- hasConflict
- accessibleLabel

Positive duration default buckets:

- 0
- 1–14
- 15–29
- 30–44
- 45–59
- 60+

Keep the bucket function configurable per tracking model. Negative events are binary or count-labeled red marks, never green intensity.

### 15.3 Positive streak

For each date, evaluate whether the streak goal threshold is satisfied.

- If today satisfies the threshold, count backward starting today.
- If today is incomplete but still open, count backward starting yesterday and label today pending.
- If a previous completed local day fails, stop.
- Future days never participate.
- Longest streak scans all completed dates and includes only qualifying runs.

An empty day means no qualifying recorded data. Do not infer hidden activity.

### 15.4 Negative-event interval

- Current interval is whole local calendar days since the latest current negative event.
- If the latest event is today, display 0 days since last event.
- Longest interval is the maximum gap between consecutive negative-event local dates and the open interval since the most recent event.
- Multiple events on one day count toward weekly maximum but do not create multiple calendar-day intervals.

### 15.5 Weekly totals

Given any selected date:

1. Compute the local week start using weekStartsOn.
2. Produce seven local dates.
3. Aggregate entries in that range.
4. Return total, active days, average over active days, and goal progress.

For negative habits, return total event count and maximum status.

### 15.6 Deadline pace

For a cumulative-by-deadline goal:

- progress = aggregate from effective start through today.
- remaining = max(target - progress, 0).
- remainingDays = inclusive count of available local dates from today through deadline according to product rules.
- requiredPerDay = ceiling(remaining / remainingDays) for minute-based display.

Specify and test whether the current day is included. Use one consistent rule everywhere. Recommended: include today while it is still open.

---

## 16. UI implementation

### 16.1 Application shell

Mobile:

- Single-column content.
- Bottom navigation with Home, Timeline, Data.
- Safe-area padding using env(safe-area-inset-bottom).

Laptop:

- Fixed or sticky narrow left rail with Home, Timeline, Data.
- Main content constrained for legibility but wide enough for heatmap.

Do not implement Settings.

### 16.2 Habit title selector

Render the large habit name as a semantic button:

- Text and chevron are one target.
- aria-haspopup is listbox or menu as appropriate.
- aria-expanded reflects state.
- Escape closes.
- Arrow keys navigate options.
- Selection updates the route.

Mobile opens a bottom sheet.
Laptop opens an anchored menu.

The menu includes active habits, Add habit, and Manage habits.

### 16.3 Heatmap component

Use semantic buttons for day cells and week headers.

Desktop:

- CSS grid with week columns and seven day rows.
- Hover tooltip is supplementary.
- Click selects persistently.
- Keyboard arrow navigation moves by adjacent day.
- Page Up/Down may move by week if implemented.

Mobile:

- Horizontally scrollable container.
- Automatically scroll newest weeks into view on first render.
- Maintain visible focus.
- Use larger invisible hit areas without visually enlarging squares.
- Tap cell opens day sheet.
- Tap week header opens week summary.

Do not render hundreds of focusable offscreen years at once. Render the visible range plus modest overscan, or paginate by range.

### 16.4 Entry editor

Use one typed form shell with model-specific fields.

Duration:

- quick minute buttons
- numeric input
- optional start and end
- local date
- optional note

Completion:

- mark complete
- optional duration and note

Negative occurrence:

- date/time
- optional note
- neutral confirmation

Dirty form behavior:

- Escape/back asks before discard.
- PWA update waits.
- Route change asks before discard.
- Save disables only while the transaction is pending.
- On success, close and focus the triggering control.
- Offer Undo for edit/delete.

### 16.5 Timeline

Entries view queries entryViews by habit and date, then loads audit data on demand.

Changes view queries authoritative events by habit and recordedAt.

Mobile:

- List.
- Entry opens sheet/page.

Laptop:

- List on left.
- Selected entry details and audit trail on right.

Do not query or render the entire history on first load. Page by local date and virtualize only if measurement shows it is needed.

### 16.6 Data screen

Data screen reads:

- event count
- coverage
- latest event
- device high-water marks
- sequence gaps
- storage estimate
- persistence result
- export history
- import history

Data screen is app-wide and has no habit selector.

---

## 17. Backup format

### 17.1 Canonical plaintext backup

The canonical interchange format is versioned JSON:

    {
      "format": "habit-tracker-backup",
      "formatVersion": 1,
      "backupId": "uuid",
      "exportedAt": "2026-09-16T20:40:00Z",
      "appVersion": "1.0.0",
      "sourceDevice": {
        "deviceId": "uuid",
        "label": "This iPhone"
      },
      "coverage": {
        "earliestLocalDate": "2026-01-01",
        "latestLocalDate": "2026-09-16",
        "latestRecordedAt": "2026-09-16T20:39:48Z"
      },
      "highWaterMarks": {
        "device-uuid": 184
      },
      "eventCount": 1241,
      "events": [],
      "checksum": {
        "algorithm": "SHA-256",
        "value": "base64url"
      }
    }

Export events in deterministic order. Compute the checksum over a documented canonical serialization of the backup content excluding the checksum field.

Document the exact canonicalization algorithm in docs/backup-format.md and test it with fixed vectors. Do not claim tamper-proof authenticity; the checksum detects accidental corruption, not malicious modification.

### 17.2 Optional encrypted backup

Recommended after canonical export/import is stable:

- Default file extension: .habitbak
- JSON envelope containing crypto metadata and ciphertext.
- Encrypt the complete canonical plaintext backup with AES-256-GCM.
- Derive the key from a user passphrase with PBKDF2-HMAC-SHA-256 using a fresh random salt and an intentionally expensive work factor.
- Generate a fresh 96-bit IV for every export.
- Include format/version metadata as authenticated additional data.
- Never store or log the passphrase.
- Require confirmation that a forgotten passphrase cannot be recovered.
- Decrypt and validate before creating an import plan.

Keep Plain JSON as an explicit advanced export for transparency and migration. Warn that it contains timestamps, values, and notes in readable form.

Do not implement custom cryptographic primitives. Use Web Crypto.

### 17.3 Privacy defaults

- Private habit name is stored only as Private.
- Private notes are optional and empty by default.
- Backup filenames are generic and do not include habit names.
- Export preview states whether the file will be plaintext or encrypted.

---

## 18. Import and reconciliation

Perform expensive parsing, checksum verification, sequence analysis, and plan generation in a Web Worker when practical. The UI must remain responsive.

### 18.1 Import state machine

    idle
      -> selecting-file
      -> reading
      -> decrypting-if-needed
      -> validating
      -> planning
      -> preview-ready
      -> resolving-conflicts
      -> creating-snapshot
      -> committing
      -> success

Any state may transition to a recoverable error with no database mutation before committing.

### 18.2 Validation

Before comparison:

- Enforce a reasonable file-size limit.
- Parse JSON.
- Validate outer format and formatVersion.
- Migrate supported older backup formats in memory.
- Validate every event with Zod.
- Reject duplicate event IDs with unequal content.
- Verify checksum if present.
- Verify event parent references where possible.
- Compute per-device sequence gaps.
- Never execute or render imported notes as HTML.

### 18.3 Plan generation

Given local events L and imported events I:

1. Same eventId and identical content: already present.
2. Same eventId and different content: corrupted or invalid file; do not merge.
3. Imported eventId absent locally: new event.
4. For each affected entity, compute heads after union.
5. One head: no conflict.
6. Multiple heads where one head descends from all others: no conflict; descendant is current.
7. Multiple divergent heads: conflict requiring a decision.
8. Compute sequence gaps across the proposed union.

The preview contains:

- alreadyPresentCount
- newEventCount
- conflictCount
- missingSequenceCount
- source devices
- coverage before and after
- projected total event count

### 18.4 Conflict decisions

Keep local:

- Create conflict.resolved with all heads as parents.
- Payload contains the chosen local snapshot.

Use imported:

- Same structure, payload contains imported snapshot.

Edit manually:

- Same structure, payload contains a newly edited snapshot.

Keep both for entry conflicts:

- Resolve the original entity to one branch.
- Create a new entry entity from the other snapshot.
- Preserve sourceEntityId for audit display.

Never delete the losing branch. It remains in history behind the resolution event.

### 18.5 Commit

Before commit:

1. Create a pre-merge snapshot of the current authoritative events and metadata.
2. Retain at least the three most recent automatic snapshots, subject to storage limits.

Then use one Dexie transaction to:

- Add all new imported events.
- Add local conflict-resolution events.
- Add system.imported audit event.
- Record import metadata.
- Update projections.

If the transaction fails, the database remains unchanged.

### 18.6 Rollback

Restore pre-merge snapshot by replacing the authoritative event set and rebuilding projections in one controlled operation.

Rollback itself must be recorded in device-local import history. If rollback is modeled as replacement rather than domain events, state this clearly in the UI.

---

## 19. Database and backup migrations

Treat three versions separately:

- IndexedDB schema version.
- Domain event schemaVersion.
- Backup formatVersion.

Rules:

- IndexedDB migrations never mutate the semantic meaning of old events.
- Old events are upgraded to current in memory before projection.
- Export always writes the latest supported backup format.
- Import supports a documented range of older formats.
- Unknown future versions fail safely with This backup was created by a newer app version.
- Every migration has fixture-based tests.
- Never deploy a database migration that was not tested against a realistic old database.

---

## 20. Error handling and recovery

### Startup failures

- If IndexedDB cannot open, show a recovery screen.
- Offer retry.
- Explain that clearing data is destructive and never make it the primary action.
- If possible, offer export before repair.

### Quota failures

- Show current usage/quota estimate where supported.
- Suggest exporting and removing old automatic snapshots.
- Never delete authoritative events automatically.

### Projection corruption

- Rebuild projections from events.
- Show progress if the rebuild is perceptible.
- If rebuild fails, preserve events and offer export.

### Invalid import

- Do not mutate the database.
- Show exact category: unreadable, wrong format, unsupported version, checksum mismatch, duplicate-ID mismatch, or validation error.
- Do not show the entire sensitive payload in error reporting.

### Global error boundary

- Preserve access to Data/export whenever possible.
- Provide a copyable non-sensitive diagnostic code.
- Do not send telemetry.

---

## 21. Security and privacy

### Threat model

Protected against:

- Accidental public-repository data exposure.
- Accidental overwrite during import.
- Duplicate imports.
- Basic backup corruption.
- Casual disclosure through the normal UI.
- Network dependence and third-party analytics.

Not protected against:

- A person with access to the unlocked browser profile and developer tools.
- Malware on the device.
- A user choosing plaintext export and sharing the file.
- Loss of an encrypted-backup passphrase.

State this honestly in documentation.

### Browser security

- Use GitHub Pages HTTPS.
- No third-party scripts, analytics, remote fonts, or ad networks.
- Bundle dependencies.
- Sanitize or render user notes as text only.
- Avoid dangerouslySetInnerHTML.
- Add a restrictive CSP meta tag compatible with the built bundle.
- Use self for scripts, workers, manifests, styles, images, and connections where possible.
- Add data: only where required for generated icons or previews.
- No eval.

Because GitHub Pages does not provide custom response headers for this application, a meta CSP is defense in depth rather than a complete header policy.

### Dependency security

- Commit the lockfile.
- Use npm audit as advisory, not an automatic destructive updater.
- Enable Dependabot.
- Review service-worker and crypto dependency changes carefully.

---

## 22. Performance requirements

Targets:

- First app shell usable quickly on a modern iPhone over ordinary mobile data.
- Full offline launch after initial load.
- Heatmap interaction at 60 frames per second.
- Entry save reflected in UI immediately after transaction completion.
- 10 years of normal personal usage without maintenance.
- At least 50,000 events supported in automated tests.
- Import of 100,000 events remains responsive, using a worker if needed.

Guidelines:

- Query only selected habit and visible date range.
- Do not replay the full event log on every render.
- Rebuild projections only after migration, repair, or explicit integrity action.
- Lazy-load Data/reconciliation code.
- Lazy-load conflict-resolution code.
- Use CSS classes for heatmap intensity rather than creating unique inline styles.
- Bundle fonts locally and subset them if they are large.
- Set a bundle-size budget and report it in CI.

Suggested initial budget:

- Main JavaScript under 250 KB gzip where practical.
- Main CSS under 50 KB gzip.
- Fonts excluded from the JavaScript budget but explicitly measured.

---

## 23. Accessibility requirements

- Meet WCAG 2.2 AA for contrast and interaction.
- Use semantic buttons and forms.
- The large habit title is a real button.
- Heatmap cells are keyboard navigable.
- Day labels announce date, value, unit, and state.
- Week headers announce range, total, and goal state.
- Color is never the only signal.
- Focus remains visible on dark surfaces.
- Dialogs trap focus and restore it on close.
- Bottom sheets expose correct dialog semantics.
- Errors are linked to fields.
- Touch targets are at least 44 × 44 CSS pixels.
- Support 200 percent zoom.
- Respect prefers-reduced-motion.
- Test with VoiceOver on iPhone and macOS.

---

## 24. Testing strategy

### 24.1 Pure domain unit tests

Cover:

- Daily aggregation by model.
- Multiple sessions on one date.
- Positive streak, longest streak, and today-pending behavior.
- Negative intervals.
- Weekly minimum/maximum.
- Deadline pace.
- Week range generation.
- DST and local-midnight behavior.
- Heatmap bucketing.
- Event head calculation.
- Ancestor and divergence detection.
- Conflict decisions.
- Backup canonicalization and checksum.
- Schema migrations.

Use table-driven tests and property-based tests for merge invariants where useful.

Key invariants:

- Importing the same backup twice is idempotent.
- Event union is commutative before local resolution events.
- Projection rebuild returns the same views.
- No authoritative event is lost by conflict resolution.
- A failed import leaves the database byte-for-byte logically unchanged.

### 24.2 Repository/database tests

Using fake-indexeddb:

- Atomic sequence allocation.
- Event plus projection transaction.
- Duplicate event rejection.
- Projection rebuild.
- Snapshot creation and restore.
- Import commit rollback.
- Dexie schema upgrades.

### 24.3 Component tests

- Habit title dropdown.
- Mobile and desktop navigation.
- Heatmap keyboard movement.
- Day and week selection.
- Entry editor validation.
- Goal progress states.
- Timeline Entries/Changes.
- Import preview.
- Conflict resolver.
- PWA update prompt with dirty form.

### 24.4 End-to-end tests

Run Chromium and WebKit:

1. First launch and onboarding.
2. Add Violin habit and deadline goal.
3. Log multiple sessions.
4. Inspect heatmap day and week.
5. Verify streak and goal update.
6. Edit and delete with audit history.
7. Export backup.
8. Clear test database.
9. Import backup.
10. Verify restored history.
11. Import same backup again and see zero new events.
12. Create divergent edits and resolve conflict.
13. Reload offline and continue using app.
14. Refresh each hash route on the built Pages-style base path.

### 24.5 Manual iPhone acceptance

On a real iPhone:

- Open from Safari.
- Add to Home Screen.
- Launch standalone.
- Log entries.
- Force close and reopen.
- Use offline.
- Export through the Files picker to iCloud Drive.
- Import through Files.
- Verify safe-area layout and keyboard behavior.
- Verify data remains after app updates.

---

## 25. Development scripts

Provide:

    npm run dev
    npm run build
    npm run preview
    npm run typecheck
    npm run lint
    npm run test
    npm run test:watch
    npm run test:e2e
    npm run test:a11y

npm run build must produce a deployable dist directory with the configured base.

Provide a development-only synthetic seed command or UI switch, but ensure it cannot accidentally export or ship as a production control.

---

## 26. Implementation phases

### Phase 0 — Repository and deployment skeleton

- Public repository.
- React/TypeScript/Vite scaffold.
- Hash routing.
- CSS tokens and responsive shell.
- Empty Home, Timeline, Data routes.
- Pages workflow.
- Verify project-path asset loading and route refresh.

Exit criterion: a static placeholder app deploys successfully and works at /REPOSITORY/.

### Phase 1 — Event database foundation

- Dexie schema.
- Device metadata and atomic sequence allocation.
- Event validators.
- Habit and goal events.
- Projection engine and rebuild.
- Synthetic onboarding.

Exit criterion: habits and goals survive reload and projections rebuild from events.

### Phase 2 — Entry logging and timeline

- Duration, completion, count, and negative occurrence editors.
- Entry create/update/delete/restore events.
- Timeline Entries and Changes.
- Mobile and desktop detail layouts.

Exit criterion: all entry models are auditable and editable without mutating old events.

### Phase 3 — Home calculations

- Timezone module.
- Daily aggregation.
- Heatmap.
- Day and week interaction.
- Streaks.
- Periodic and deadline goals.
- Private-habit semantics.

Exit criterion: screenshot sample data produces the expected totals, streaks, week summary, and pace.

### Phase 4 — Backup and basic restore

- Canonical JSON export.
- Validation.
- Checksum.
- Import preview.
- Exact deduplication.
- Atomic import.
- Automatic pre-merge snapshot.

Exit criterion: export, clear, import restores identical projections; reimport is idempotent.

### Phase 5 — Reconciliation

- Entity ancestry.
- Divergent-head detection.
- Conflict comparison.
- Keep local, imported, both, and manual.
- Rollback.
- Sequence gap reporting.

Exit criterion: two independently edited device histories can be safely merged with no hidden data loss.

### Phase 6 — PWA and hardening

- Manifest and icons.
- Offline precache.
- Update prompt.
- Persistent-storage request.
- Accessibility review.
- Real iPhone testing.
- Performance budgets.
- Optional encrypted backup.

Exit criterion: installed iPhone PWA and laptop app pass the end-to-end acceptance path offline.

---

## 27. Definition of done

The first release is done only when:

- It deploys from the public repository to GitHub Pages through Actions.
- No backend or secret is required.
- All assets load under the repository subpath.
- Refreshing Home, Timeline, and Data hash routes works.
- It can be installed as a PWA.
- It works offline after first load.
- IndexedDB is the only runtime data store.
- No real personal data exists in the repository.
- The user can add and select habits without a Settings page.
- The selected habit Home shows today, streaks, heatmap, week totals, and every active goal.
- Private habits never reveal a sensitive name.
- A negative event is visually and semantically distinct.
- Timezone and week boundaries are correct.
- Every create, update, and delete is auditable.
- JSON export/import is documented and tested.
- Duplicate imports are harmless.
- Divergent edits are never silently overwritten.
- The Data screen shows coverage and sequence integrity.
- Mobile Safari and laptop browsers pass the primary flows.
- Automated unit, database, component, and end-to-end tests pass.

---

## 28. Initial engineering decisions that must not be changed casually

1. Static-only GitHub Pages deployment.
2. HashRouter instead of server-rewrite routing.
3. IndexedDB through Dexie, not localStorage.
4. Immutable event log as the source of truth.
5. Rebuildable projections for performance.
6. Explicit local date plus timezone preservation.
7. Manual conflict resolution for divergent edits.
8. One selected habit per Home/Timeline screen.
9. No Settings page.
10. No secret or personal data in the public repository.
11. No external analytics, fonts, or runtime services.
12. Full export before any origin/domain migration.

Any proposal to change one of these decisions must document the problem, alternative, migration effect, privacy effect, and impact on existing backups.

---

## 29. Required implementation deliverables

The implementing agent should produce:

- Complete application source.
- GitHub Pages Actions workflows.
- PWA assets and manifest.
- IndexedDB schema and migrations.
- Event and backup format documentation.
- Pure calculation modules.
- Responsive Home, Timeline, and Data screens.
- Habit, goal, entry, import, and conflict interactions.
- Unit, database, component, accessibility, and end-to-end tests.
- README with local development and Pages deployment.
- Privacy/threat-model documentation.
- Backup migration documentation.
- A synthetic demo-data generator.

Do not substitute mock data for persistence in the finished application.
Do not omit merge behavior merely because only one device is used initially.
Do not add cloud infrastructure to simplify reconciliation.

---

## 30. Authoritative references

- [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Pages availability and limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Vite static deployment and GitHub Pages base paths](https://vite.dev/guide/static-deploy)
- [Vite environment variables are bundled and are not secrets](https://vite.dev/guide/env-and-mode)
- [MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN persistent storage request](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [Vite PWA service-worker registration](https://vite-pwa-org.netlify.app/guide/register-service-worker)
- [MDN Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [MDN AES encryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [MDN key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

Use current official documentation when implementation begins, especially for GitHub Actions major versions and PWA tooling.
