# Habit Tracker — Product and Interaction Design Brief

> **Note on this copy.** This repository is public. One sentence of the original
> brief named the real-world subject of the private habit. Reproducing it here
> would publish exactly the detail the product is designed to keep private, so
> that name is redacted below. Nothing else has been changed.

## Instruction to the designer

Design a responsive, mobile-first web application for privately tracking positive and negative habits. Produce a coherent interaction system and high-fidelity screens for both mobile web and laptop web. Do not treat this as a generic checklist, task manager, or multi-habit dashboard.

The product should focus on **one selected habit at a time**. Its primary purpose is to make momentum visible through practice time, streaks, a contribution-style heatmap, weekly summaries, and long-term goal progress. It must also make the user's data history understandable and portable because all data is initially stored locally in the browser.

The design should feel motivating because progress is legible—not because it uses badges, confetti, bright colors, mascots, or guilt.

---

## 1. Product context

This is a personal, local-first habit tracker delivered as an installable progressive web app. The static site may be hosted on GitHub Pages. Habit data is stored locally in IndexedDB. There is no account, backend, subscription, social feed, or automatic cloud synchronization in the first version.

Users can export a complete JSON backup to iCloud Drive or another file location and import it on another device. Imports merge immutable events rather than replacing the existing database.

The initial habits are:

| Habit | Tracking model | Example goals |
| --- | --- | --- |
| Violin practice | Duration in minutes; multiple sessions per day | Maintain a daily streak; complete 60 hours by December 31 |
| MARL study | Duration in minutes | Maintain a streak; complete at least 5 hours per week |
| Workout | Completion, session count, or optional duration | Maintain a streak; complete at least 4 sessions per week |
| Private habit | Negative occurrences | Maintain time since the last event; do not exceed 2 occurrences per week |

The sensitive habit's real name must never be exposed in the normal interface. Display it as **Private** with a lock icon. Do not use the habit's real-world name *[redacted in this public copy]* anywhere in the UI.

---

## 2. Core product principles

### One habit at a time

Never put cards for every habit on the Home screen. Home is a focused workspace for the currently selected habit. The user changes habits by opening the large habit name itself.

### The habit name is the selector

The large page title—for example, **Violin practice ▾**—is the dropdown control. Do not add selector chips, a second compact dropdown, or a separate habit-switching toolbar.

### Progress should be immediately understandable

For the selected habit, Home must make these answers obvious:

- What did I do today?
- What is my current streak?
- How consistent have I been over recent weeks?
- How much did I do on a particular day or week?
- What active goals apply to this habit?
- Am I on pace to meet those goals?

### Motivation through continuity

Use large metrics, streak continuity, contribution heatmaps, pace calculations, and clear remaining work. Avoid game currencies, achievements, levels, motivational quotes, guilt, or celebratory clutter.

### Neutral treatment of negative habits

A private-habit occurrence is a negative event and should be represented differently from positive activity. Use a restrained red mark for an occurrence. Do not color no-event days green as though absence were an activity. Use factual language such as "4 days since last event," "1 of 2 events this week," and "1 remaining before weekly limit."

### Local time is authoritative

Daily streaks, weekly minimums and maximums, deadlines, and heatmap cells are calculated in the user's configured timezone. Show the timezone and week definition in context, for example:

> Pacific Time · Weeks run Monday–Sunday

### Local data should not feel fragile

Make exports, imports, coverage dates, sequence integrity, merge previews, and conflicts understandable. The user should always know what data exists and what an import will do.

---

## 3. Information architecture

Use exactly three primary destinations:

1. **Home** — progress, heatmap, streaks, goals, and logging for the selected habit.
2. **Timeline** — chronological entries and their complete change history for the selected habit.
3. **Data** — whole-application export, import, reconciliation, integrity, and backup history.

There is no Settings destination and no Settings icon.

On mobile, use a fixed bottom navigation bar. On laptop, use a narrow left navigation rail. Do not add a separate Insights page: the useful insights belong on the selected habit's Home screen.

The Data screen is application-wide, so it does not need a habit selector.

---

## 4. Responsive layout system

### Mobile web: approximately 360–430 px wide

- Use a single-column layout.
- Use fixed bottom navigation for Home, Timeline, and Data.
- Keep the large habit-title dropdown near the top.
- Make the heatmap horizontally scrollable when the selected time range cannot fit legibly.
- Show roughly 10–12 weeks in the initial viewport rather than shrinking cells until they are untappable.
- Use bottom sheets for habit selection, day details, week summaries, logging, editing, and conflict resolution.
- Preserve at least 44 × 44 px interactive targets.
- Do not hide essential actions behind hover.

### Laptop web: approximately 1024–1600 px wide

- Use a narrow left navigation rail containing only Home, Timeline, and Data.
- Place the large habit-title dropdown at the top of the main content—not inside the navigation rail.
- Use the extra width to show a larger heatmap and persistent supporting panels.
- Home can place the goal panel beside the heatmap.
- Timeline should use a list-and-detail split view.
- Data should use a backup/integrity column and a reconciliation-preview column.
- Hover may provide previews, but click and keyboard interactions must perform every essential action.

### Intermediate widths

- Collapse the desktop rail before compressing the heatmap beyond usability.
- Move secondary panels below primary content.
- Preserve the same information hierarchy and interaction vocabulary.

---

## 5. Visual direction

Use a restrained editorial data-journal style rather than a generic productivity dashboard.

- Deep charcoal background.
- Warm ivory primary text.
- Layered charcoal surfaces with crisp, thin borders.
- Restrained forest/mint green for positive activity and successful progress.
- Muted crimson only for negative events and destructive actions.
- Muted amber for warnings and unresolved import conflicts.
- Expressive display typography for habit names and important numbers.
- Highly readable sans-serif typography for controls, labels, timestamps, and metadata.
- Exact, satisfying heatmap geometry.
- Generous whitespace, but not oversized empty cards.

Avoid:

- Habit-selector chips.
- A Settings screen or gear icon.
- Glassmorphism and decorative gradients.
- Excessive shadows and rounded SaaS cards.
- Pie charts and generic analytics charts.
- Confetti, streak flames, trophies, mascots, emoji, and motivational quotes.
- Showing every habit's metrics at once.

---

## 6. Habit dropdown interaction

The control is the large title itself: **Violin practice ▾**.

### Closed state

- The full habit name is large and prominent.
- A down chevron appears directly beside the name.
- The complete title area is clickable/tappable and keyboard accessible.

### Open state on mobile

Open a bottom sheet titled **Choose habit**. List:

- Violin practice — Minutes
- MARL study — Minutes
- Workout — Sessions
- Private — Events, with a lock icon

Show a checkmark on the selected habit. Include two quiet actions below a divider:

- **Add habit**
- **Manage habits**

These actions open focused flows; they do not lead to a general Settings screen.

### Open state on laptop

Open a well-positioned menu beneath the large title. Use the same information and actions as mobile. The menu should be wide enough for readable names and units.

### Selection behavior

- Changing the habit updates Home or Timeline in place and preserves the current primary destination.
- Remember the last selected habit locally.
- When Private is selected, continue displaying only "Private."

---

## 7. Home screen

Home is the main motivational screen and always represents one selected habit.

### 7.1 Header and today state

For Violin, show:

- Large dropdown title: **Violin practice ▾**
- Date: **Wednesday, September 16**
- Large value: **25 min**
- Label: **Today**
- Primary action: **+ Log practice**
- Current streak: **7 days**
- Longest streak: **18 days**

If the current day has not yet satisfied the streak rule, distinguish between "streak already broken" and "today still available." For example:

> Practice today to continue your 7-day streak

Do not break a streak before the local day has ended.

### 7.2 Contribution-style heatmap

The heatmap is the visual center of Home.

- Columns represent weeks.
- Rows represent local weekdays.
- Each cell represents one local calendar date.
- Positive duration habits use intensity based on total minutes that day.
- Multiple sessions on a day are summed for the cell value.
- Future dates are visually unavailable.
- Empty positive-habit cells mean "No practice recorded," not necessarily "confirmed zero."
- Provide a legend, for example: 0, 1–14, 15–29, 30–44, 45–59, 60+ min.
- Desktop should initially show approximately 20 weeks.
- Mobile should show approximately 12 weeks and support horizontal scrolling to older weeks.

#### Day-cell interaction

On desktop hover, show a small tooltip. On click or mobile tap, select the cell and open persistent details.

Example:

> Wed, Sep 16 · 25 min

The day detail should show:

- Date.
- Total duration or count.
- Individual sessions.
- Notes, if present.
- Add another session.
- Edit existing sessions.

On mobile, use a compact bottom sheet. On laptop, use a popover or adjacent detail panel.

#### Week-marker interaction

Each week column has a clickable week marker such as **W37**. Selecting it highlights the complete column and shows:

- **Week 37 · Sep 14–20**
- **2h 45m total practice time**
- **5 practice days**
- **33 min daily average**
- Relevant weekly goal progress, when applicable

A selected day belongs to a selected week, but the UI must distinguish day detail from week summary. Clicking a new week updates the week summary without inventing a day selection.

### 7.3 Active goal area

Show all active goals for the selected habit, but no goals from other habits.

Supported goal presentations:

#### Cumulative deadline goal

Example:

- **60 hours by Dec 31**
- **18h 40m / 60h**
- **31% complete**
- **41h 20m remaining**
- **106 days left**
- **23 min/day to finish**

Use a strong linear progress indicator. The daily pace should respond to the user's timezone and remaining local calendar days.

#### Weekly minimum

Example for MARL:

- **3h 15m / 5h this week**
- **1h 45m remaining**
- **4 days left in this week**

#### Weekly occurrence minimum

Example for Workout:

- **3 / 4 sessions this week**
- **1 session remaining**

#### Weekly maximum

Example for Private:

- **1 / 2 events this week**
- **1 remaining before weekly limit**
- **Resets Monday at 12:00 AM Pacific Time**

If the maximum is exceeded, state it factually:

> 3 / 2 events · Weekly limit exceeded by 1

Do not use moralizing language.

### 7.4 Editing goals without Settings

Provide a quiet **Edit goals** action inside the selected habit's goal area or its overflow menu. Open a focused modal/bottom sheet. It should support:

- Goal type.
- Amount and unit.
- Period or deadline.
- Timezone.
- Week start day.
- Streak qualification threshold.

Changes should affect future calculations while preserving the historical change record.

---

## 8. Logging and editing entries

### Entry flow behavior

- Mobile: bottom sheet.
- Laptop: modal or right-side panel.
- Preselect the current habit, current local date, and current time.
- Make the fastest common action possible in one or two taps.
- Saving updates today's value, heatmap, streak, week total, and goals immediately.
- Show a brief Undo action after saving.
- Editing creates a new audit event; it does not destructively rewrite history.
- Deleting creates a deletion event/tombstone and offers Undo.

### Duration habit form

For Violin and MARL:

- Duration entry with quick choices: 15, 30, 45, and 60 minutes.
- Direct numeric entry.
- Optional start/end time instead of duration.
- Local date.
- Optional note.
- Allow multiple sessions on the same day.

If start/end time and duration disagree, ask the user to resolve the discrepancy before saving.

### Completion/session habit form

For Workout:

- Primary action: **Mark complete**.
- Optional duration, session type, reps, and note.
- Prevent accidental duplicate completions, but allow another session intentionally.

### Negative-event form

For Private:

- Action label: **Log event**.
- Local date and time.
- Optional private note.
- Confirmation should be neutral and concise.
- Use muted red only as an event semantic, not as an alarming full-screen warning.
- After save, update days since last event, the red heatmap mark, and weekly maximum progress.

---

## 9. Private-habit Home variant

The Private screen uses the same one-habit structure but different semantics.

Header example:

- **Private ▾** with lock icon.
- **4 days**.
- Label: **Since last event**.
- Longest interval: **12 days**.
- Action: **Log event**.

Heatmap:

- Occurrence days receive a restrained crimson mark.
- No-event days remain neutral/dark.
- Do not use green intensity for abstinence.
- Clicking an event day shows the event time and its change history.
- Week selection shows the number of events that week and whether the weekly maximum was exceeded.

Goal example:

- **Weekly maximum: 2**
- **1 / 2 events this week**
- **1 remaining before limit**
- **Resets Monday · Pacific Time**

Do not expose the real habit name in titles, navigation, file summaries, notifications, or recent-activity text.

---

## 10. Timeline screen

Timeline represents the selected habit and uses the same large habit-title dropdown.

### Header

- **Violin practice ▾**
- Page label: **Timeline**
- Primary action: **+ Log practice**
- Two views: **Entries** and **Changes**

### Entries view

Group entries by local calendar date. Show the daily total followed by individual sessions.

Example:

**Today · Sep 16 — 25 min**

- 6:15–6:40 PM · 25 min
- Scales and bowing
- Recorded 6:42 PM · This iPhone

**Tuesday · Sep 15 — 35 min**

- 5:20–5:40 PM · Technique exercises · 20 min
- 7:10–7:25 PM · Repertoire · 15 min

**Monday · Sep 14 — 30 min**

- Edited from 25 min at 9:12 PM

Recent missing days may appear as **No practice recorded** to make continuity understandable. Do not generate thousands of empty historical rows; after the recent period, show only dates that contain activity or changes.

### Entry detail

On mobile, tapping an entry opens a detail page or bottom sheet. On laptop, show it in a persistent right pane.

Include:

- Occurrence date and time.
- Duration/count.
- Note.
- Device that recorded it.
- Recorded timestamp.
- Edit and Delete actions.
- Expandable technical details containing event ID and version ancestry.

### Changes view

Show the immutable audit timeline in user-friendly language:

- Entry created.
- Duration changed from 25 to 30 minutes.
- Entry deleted.
- Entry restored through Undo.
- Events imported from another device.
- Conflict resolved using local/imported/manual value.

Every change should show recorded time and source device. Clearly distinguish when the habit occurred from when its record was changed.

---

## 11. Data screen

Data applies to the whole app and therefore has no habit selector.

### Local device summary

Example:

- **[Device name]**
- **1,241 events**
- **Coverage: Jan 1–Sep 16, 2026**
- **No sequence gaps**
- **Export backup**
- **Import backup**

Explain "coverage" as the earliest and latest occurrence represented in the event log. Show the latest event timestamp separately when useful.

### Export flow

- Export a complete, versioned JSON backup.
- Show the suggested filename before saving.
- Use the device file picker so the user can choose iCloud Drive or another location.
- Record locally that an export was made, including date, event count, coverage, and filename.
- Confirm success without implying cloud synchronization.

### Import flow

After selecting a file, never merge immediately. First show a preview:

- File name.
- Source device.
- Export timestamp.
- Coverage range.
- Schema version.
- Already-present events.
- New events.
- Conflicts.
- Missing device sequences.

Example:

- **1,204 already present**
- **37 new events**
- **1 conflict**
- **0 missing sequences**

State clearly:

> Nothing will be overwritten.

Before merging, create a local pre-merge snapshot automatically.

### Conflict resolution

If two devices independently edited the same logical entry, show a focused comparison screen.

For each conflict, display:

- Habit alias.
- Occurrence date/time.
- Common ancestor value.
- Local version, recorded time, and device.
- Imported version, recorded time, and device.
- Differences in duration/count, date/time, note, and deletion state.

Actions:

- **Keep local**
- **Use imported**
- **Keep both** when both can represent separate legitimate sessions
- **Edit manually**

Explain the projected result before applying it. After all conflicts are resolved, allow the merge.

### Merge-complete state

Show:

- New events added.
- Duplicates ignored.
- Conflicts resolved.
- New total event count.
- New coverage range.
- Whether any sequence gaps remain.
- **Undo merge** or **Restore pre-merge snapshot**.

---

## 12. Add and manage habits

There is no Settings page. Access these flows through the habit-title dropdown.

### Add habit

Ask for:

1. Display name.
2. Tracking model: duration, completion, count, or negative occurrence.
3. Unit.
4. Whether the name should be masked as Private.
5. Initial streak rule.
6. Optional initial goal.
7. Timezone and week-start confirmation.

Show a small live preview of how the Home header and heatmap will interpret entries.

### Manage habits

Provide a focused modal/page for:

- Reordering habits in the dropdown.
- Renaming the display label.
- Changing the unit for future entries.
- Archiving or restoring a habit.
- Editing goals.
- Exporting one habit's data.

Do not allow a destructive type conversion that silently changes existing history. If the tracking model changes, explain whether old data remains compatible.

---

## 13. Time and calculation semantics

Design labels and states around these rules:

- Store precise occurrence timestamps, but group entries by local date in the configured timezone.
- Weeks use the configured start day and local midnight boundaries.
- Multiple duration entries on the same local date sum into one heatmap cell.
- A duration streak day qualifies only when its configured minimum is met.
- A completion streak day qualifies when at least one completion exists.
- A negative-habit occurrence resets the time-since-last-event streak.
- A weekly maximum counts occurrence events within that local week.
- Editing an occurrence date may move an entry between heatmap cells or weeks; preview this consequence.
- Future dates never count toward missed streak days.
- Today remains pending until the local day ends.
- Deadline pacing uses remaining local calendar days, not raw 24-hour intervals.

Whenever an edit changes streaks, a week total, or goal progress, show the consequence before save when it is surprising.

---

## 14. Required interaction states

Design, at minimum:

- Default, hover, focus, pressed, disabled, loading, and offline states.
- Heatmap empty, low, medium, high, future, selected-day, and selected-week states.
- Positive-goal on pace, behind pace, completed, and expired states.
- Weekly maximum safe, near limit, reached, and exceeded states.
- Current streak active, today pending, and broken states.
- Empty new habit.
- No entries in selected range.
- Export success and failure.
- Invalid or unsupported backup file.
- Import with no new events.
- Import with conflicts.
- Merge success, partial failure, and rollback.
- Archived habit.

---

## 15. Accessibility and input support

- Meet WCAG AA contrast.
- Never communicate intensity or negative events through color alone; use labels, outlines, icons, or legends too.
- Make heatmap cells keyboard navigable with arrow keys.
- Enter/Space opens day detail.
- Week headers must be focusable and announce their date range and total.
- Tooltips must also work through focus and tap.
- Provide accessible names such as "September 16, 25 minutes practiced."
- Support zoom and dynamic text without overlapping metrics.
- Use visible focus styles.
- Respect reduced-motion preferences.
- Ensure every mobile target is at least 44 × 44 px, even when the visible heatmap square is smaller; use expanded invisible hit areas if necessary.

---

## 16. Sample data to use consistently in mockups

Use September 16, 2026 in Pacific Time, with weeks running Monday–Sunday.

### Violin

- Today: 25 minutes.
- Current streak: 7 days.
- Longest streak: 18 days.
- Selected week: Week 37, Sep 14–20.
- Week total: 2h 45m.
- Practice days: 5.
- Average: 33 minutes.
- Goal: 60 hours by Dec 31.
- Completed: 18h 40m.
- Remaining: 41h 20m.
- Pace: 23 min/day to finish.

### MARL

- Today: 45 minutes.
- Current streak: 5 days.
- Weekly goal: 3h 15m / 5h.
- Remaining: 1h 45m.

### Workout

- Today: completed.
- Current streak: 4 days.
- Weekly goal: 3 / 4 sessions.

### Private

- 4 days since the last event.
- Longest interval: 12 days.
- Weekly maximum: 2.
- Current week: 1 / 2 events.

---

## 17. Required screens and flows to deliver

Create both mobile and laptop variants where the layout materially changes.

1. Violin Home — default state.
2. Violin Home — selected day and selected week.
3. Habit dropdown — open state.
4. Log duration entry.
5. Edit duration entry and consequence preview.
6. Private Home variant.
7. Log negative event confirmation.
8. Timeline — Entries view.
9. Timeline — Changes view.
10. Entry detail and audit trail.
11. Data — default local-device state.
12. Export backup confirmation.
13. Import preview.
14. Conflict comparison and resolution.
15. Merge-complete summary and rollback.
16. Add-habit flow.
17. Add/edit-goal flow.
18. New-user/empty state.

Also provide:

- A component inventory.
- Responsive behavior notes for each component.
- A state matrix for heatmap cells, streaks, goals, and imports.
- Click/tap/keyboard behavior annotations.
- A short end-to-end prototype path covering: select Violin → inspect a day → inspect a week → log practice → view Timeline → export backup.
- A second path covering: select Private → log an event → inspect weekly maximum → import a backup → resolve a conflict.

---

## 18. Out of scope

Do not design:

- Accounts or authentication.
- Automatic cloud synchronization.
- Social features, sharing, leaderboards, or public profiles.
- Subscription/paywall screens.
- Push notifications or reminder settings.
- A general Settings page.
- A multi-habit dashboard.
- AI coaching.
- Decorative analytics that do not help with streaks, goals, history, or data integrity.

---

## 19. Success criteria

The design succeeds when:

- A user can record common activity from Home in a few seconds.
- One habit's progress is understandable without looking at another screen.
- A heatmap cell reveals the exact day value.
- A week header reveals the exact week total.
- Streak qualification and "today pending" behavior are unambiguous.
- Every active goal for the selected habit is visible and actionable.
- The Private habit remains discreet and nonjudgmental while negative events remain visually distinct.
- Mobile never feels like a compressed desktop dashboard.
- Laptop uses its width for inspection and detail, not unrelated widgets.
- The user can understand exactly what data is on the device.
- An import preview makes duplicates, new events, gaps, and conflicts explicit before any mutation.
- No normal flow requires or suggests a Settings page.

Use this brief as the source of truth. Resolve visual details in service of these behaviors rather than adding new product scope.
