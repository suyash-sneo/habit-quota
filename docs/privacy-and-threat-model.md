# Privacy and threat model

This is an honest account of what this app protects and what it does not. It is
deliberately specific, because vague reassurance is worse than none.

## What the app is

A static site. HTML, CSS, JavaScript, fonts and icons, served by GitHub Pages.
There is no backend, no account, no API key, and no analytics. Your habit data
lives in this browser's IndexedDB and leaves it only in a backup file you
explicitly create and place yourself.

## What is protected

**Accidental exposure through the public repository.** The repository contains
source code only. IndexedDB contents are not in it and cannot be. Backup
filename patterns are in `.gitignore`, and the demo-data generator refuses to run
outside a development build.

**Accidental overwrite during an import.** Merging is additive and by immutable
event id. Nothing is ever replaced. A preview shows exactly what would be added
before a single row is written, and a pre-merge snapshot is taken first.

**Duplicate imports.** Importing the same backup twice adds nothing the second
time. This is asserted by tests.

**Silent data loss from two devices.** Divergent edits are surfaced as conflicts
and never resolved by timestamp. Both branches stay in the log after a decision.

**Basic file corruption.** A SHA-256 checksum over a canonical serialization
catches truncation and re-encoding.

**Casual disclosure through the interface.** A habit can be masked. Its real name
is never stored anywhere — not in a hidden field, not in an event, not in a
backup. The UI, filenames and history show only `Private`.

**Network dependence.** After the first load the app works fully offline. It
makes no third-party requests at all; fonts are self-hosted and there are no
remote scripts. A test asserts that no request leaves the app's own origin.

## What is *not* protected

**Anyone with your unlocked browser profile.** IndexedDB is not encrypted. A
person at your unlocked computer, or with your unlocked phone, can read
everything through developer tools. Masking a habit's name hides it from the
interface, not from the database.

**Malware on the device.** Nothing an in-page app can do defends against code
running with your privileges.

**A plaintext backup you share.** Exported JSON is readable text containing
timestamps, values and notes. Where you put that file is entirely up to you, and
so is who can then read it.

**Encrypted backups.** Not implemented in this release. The export sheet says
plainly that the file is plaintext rather than implying protection that does not
exist. See "Not yet built" below.

**Browser storage is not a backup.** Clearing site data deletes everything. Some
browsers evict storage under pressure, particularly on iOS. The app requests
persistent storage once you have data worth keeping and reports the answer on the
Data screen without alarm — a refusal is normal. The honest mitigation is to
export a file whenever losing your recent history would hurt.

## Origin and data location

IndexedDB is scoped to an **origin**, not to a repository.

- A project site at `https://USERNAME.github.io/habit-quota/` uses the origin
  `https://USERNAME.github.io`.
- Other project sites on that same hostname share the origin. This app uses a
  unique database name (`habit-tracker-local-v1`), so they do not collide.
- Renaming the repository changes the path but not the origin, so data survives.
- **Moving to a custom domain changes the origin, and data does not follow.**
  Export from the old origin and import into the new one. This is the single most
  likely way to lose data, so do it deliberately.

## Browser security posture

- HTTPS, via GitHub Pages.
- No third-party scripts, analytics, ad networks or remote fonts.
- All dependencies are bundled; the lockfile is committed.
- User notes are rendered as text. `dangerouslySetInnerHTML` is banned by a lint
  rule, and so is `eval`.
- A restrictive Content Security Policy ships as a `<meta>` tag:

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self';
  worker-src 'self' blob:; manifest-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'none'
  ```

  Two honest caveats. GitHub Pages cannot send response headers, so a meta policy
  is defence in depth rather than a complete one. And `frame-ancestors` is
  **ignored** when delivered via `<meta>`, so it is deliberately absent rather
  than present and misleading — this app cannot prevent being framed.
  `'unsafe-inline'` is present for styles only, because React sets `style`
  attributes for the goal progress bar; scripts have no such allowance.

## Diagnostics

Errors are logged to the browser console and nowhere else. The recovery screen
shows a short diagnostic code derived from the error type and message — it
contains no habit data — purely so you can write it down. Nothing is transmitted.

## Destructive actions

Only one action deletes data: **Delete all local data** on the recovery screen.
It is placed last, labelled as a last resort, and requires confirmation. The
recovery screen offers "Export what can be read" first, because the useful order
is almost always export, then repair.

## Not yet built

**Encrypted backups.** The intended design, for when it lands: AES-256-GCM over
the complete canonical plaintext backup, with the key derived from a passphrase
via PBKDF2-HMAC-SHA-256 using a fresh random salt and a deliberately expensive
work factor, a fresh 96-bit IV per export, and the format metadata as
authenticated additional data — using Web Crypto, never a hand-rolled primitive.
Plain JSON would remain available as an explicit advanced option for transparency
and migration, and a forgotten passphrase would be unrecoverable, which the UI
would have to say before the first encrypted export.

Until that exists, treat every exported file as readable by anyone who obtains
it.

## Reporting a problem

This is a personal, local-first application with no server and no user data under
anyone else's control. If you find a security problem in the code, open an issue
describing the class of problem. Please do not include real habit data or a
working exploit.
