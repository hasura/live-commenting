# Collaborative HTML Annotation Library

A commenting layer for generated HTML artifacts. Reviewers leave threads
anchored to parts of a document — a card, a table cell, a phrase in a paragraph,
a rectangle on an image — and the comments survive regeneration of the artifact
because they anchor to declared identity, not to DOM position.

The artifact and the annotation layer are kept strictly apart:

- The **artifact** emits `data-anno-*` attributes (id, label, optional mode and
  semantic payload) and nothing else. `fixture/src/anno.ts` is the whole
  artifact-side contract and has zero imports by design.
- The **annotation layer** (`fixture/src/annotations/`) mounts separately, reads
  those attributes off the DOM, and renders pins, outlines, highlights and
  threads. It is controlled: the host owns the annotation document and persists
  it however it likes.

Implemented: element references, block-scoped text selection, fractional image
regions, a DOM-free semantic flattener for prompting, and an event-log model
(`foldEvents` / `diffDoc`) for server-backed hosts. A reference **review app**
(`fixture/server.mjs`) shows the layer wired to a host where every comment is
shared the moment it is posted and the owning [PromptQL](https://promptql.io)
bot reads the complete history from its shell and acts only when explicitly invoked.

## Documentation

| File | Read it for |
|---|---|
| `INSTRUCTIONS.md` | Making an artifact commentable and mounting the layer — attributes, id scheme, document schema, custom composers, text/region/event APIs, the bot's `anno.mjs`, packaged consumption |
| `fixture/README.md` | The reference fixture: why it is shaped the way it is, the planted hit-test cases, the overlay positioning rule |

## Repository layout

```
INSTRUCTIONS.md                       how to use the library
fixture/                              Vite + React 19 + TypeScript
  src/anno.ts                         artifact-side contract (zero imports)
  src/annotations/                    the annotation layer — no dependency on fixture/, packaged as-is
    review.ts                         DOM-free: flattenAnnotations
    events.ts                         DOM-free: the event log — applyEvent, foldEvents, diffDoc
    selection.ts                      text-range and image-region selection
  src/fixture/                        the reference artifact the layer is developed against
  src/dev/                            dev inspector (development build only)
  src/App.tsx                         host: dev fixture (localStorage) or shared review app (/api)
  server.mjs                          review app: static build + SQLite event log + /api + bot socket
  scripts/anno.mjs                    the bot's CLI: read / reply / resolve / reopen over the Unix socket
  scripts/browser.mjs                 browser resolution shared by the suites
  scripts/check-fixture.mjs           artifact contract + planted-case geometry (20 assertions)
  scripts/check-annotations.mjs       the annotation layer, end to end (46 assertions)
  scripts/check-advanced.mjs          real text/region gestures, quotes, event-log helpers, IME, popovers (24)
  scripts/check-ergonomics.mjs        touch, keyboard, focus, event folding, hide overlays (12)
  scripts/check-image-example.mjs     raster image-region annotation example (15)
  scripts/check-server.mjs            review server + anno.mjs against a fake platform API, no browser (43)
  scripts/check-shared-app.mjs        two reviewers + the bot, real browser + server, fake platform API (27)
  scripts/package-library.mjs         emits lib/ (ESM + CSS + declarations + package.json)
  public/reference-screenshot.svg     fixture image asset (planted case 5)
  public/image-annotation-example.*   raster image-region example (SVG source + committed PNG)
  vite.library.config.ts, tsconfig.library.json   library build
```

`fixture/src/annotations/` has no dependency on `fixture/src/fixture/` and is
what `npm run build:library` packages.

## Requirements

- Node 20.19+ or 22.12+ (Vite 7's minimum). Tested on Node 24.
- For the check suites: a Chromium-family browser already installed (Chrome or
  Chromium from your distro's packages is fine). `playwright-core` downloads
  nothing.

## Build

```sh
cd fixture
npm ci
```

Some npm versions block postinstall scripts by default. `esbuild` needs one, or
Vite won't start. `package.json` already whitelists it under `allowScripts`; if
your npm ignores that field it will print a warning telling you how to approve
it (on npm 11 that is `npm approve-scripts esbuild`).

```sh
npm run typecheck        # tsc -b --noEmit
npm run build:library    # → fixture/lib/  (ESM library, CSS, declarations, anno + review helpers)
npm run build            # tsc -b && vite build → fixture/dist/
npm run preview          # serve the production build locally
```

`server.mjs` has no build dependency of its own (Node 22.5+/24 for `node:sqlite`);
`npm run build` is enough to run the review server.

## Run the development fixture

```sh
cd fixture
npm run dev -- --host 0.0.0.0 --port 5180 --strictPort
```

Development mode keeps the document in `localStorage` under
`annotation-fixture-doc` with a labelled demo identity, and shows the
**fixture inspector** (bottom right) — what the artifact declares and, on its
**document** tab, the live annotation JSON. The inspector is not in the
production build.

Press `C` or click **Comment** in the bottom toolbar. Click or tap selects the
nearest declared element; dragging selects a text range (on `mode="text"`
targets) or a rectangle (on `mode="region"` targets); `Alt+Enter` annotates an
existing native text selection. `Enter` posts, `Shift+Enter` newlines, `Esc`
dismisses one layer.

## Test

All suites drive a real Chromium-family browser through `playwright-core`. They
need the **dev server already running on 5180** (the app suites need the review
server instead — see below).

```sh
cd fixture
npm run dev -- --host 0.0.0.0 --port 5180 --strictPort &

node scripts/check-fixture.mjs         # 20 assertions
node scripts/check-annotations.mjs     # 46
node scripts/check-advanced.mjs        # 24
node scripts/check-ergonomics.mjs      # 12
node scripts/check-image-example.mjs   # 15 — also needs the review server on 5190 (production rendering check)
node scripts/check-mobile-followup.mjs # touch toggle states, tooltip and asynchronous first-save lifecycle
```

`check-fixture` and `check-annotations` resolve a browser through
`scripts/browser.mjs` and run headless by default; they take an optional URL
argument for a non-default port. The other suites attach to a running Chrome
over the DevTools protocol: start one with remote debugging enabled and point
them at it.

```sh
google-chrome --headless=new --remote-debugging-port=9222 about:blank &
export CDP_URL=http://127.0.0.1:9222     # check-fixture/annotations attach too when this is set
```

A non-zero exit means a real failure. Every script prints each assertion as it
goes, so the first `FAIL` line is the lead.

`check-fixture.mjs` verifies that every planted hit-test case still holds
geometrically, so if a CSS "tidy-up" makes a case stop being hard, it fails
loudly rather than silently making the suite easier. It also compares overlay
boxes against their elements after page scroll and after inner-container
scroll, and asserts that comparison was non-empty. Keep that assertion — a
vacuous pass is how a positioning drift bug slips through.

### Browser resolution

`scripts/browser.mjs` finds a browser without hardcoding a path, in order:

1. `$CDP_URL`, if set — attach to an already running Chrome
2. `$CHROME_PATH`, if set
3. the usual install locations (`/usr/bin/google-chrome{,-stable}`,
   `/usr/bin/chromium{,-browser}`, `/snap/bin/chromium`, …)
4. Playwright's `channel: 'chrome'`, which does its own system lookup

| Env var | Effect |
|---|---|
| `CDP_URL=http://127.0.0.1:9222` | attach to a running Chrome instead of launching one |
| `CHROME_PATH=/path/to/chrome` | point it at a browser it can't find |
| `HEADED=1` | run visibly instead of headless — needs a working display |
| `TEST_OUTPUT_DIR` | where the newer suites write screenshots and JSON reports (default `test-output/`) |

## The review app

`fixture/server.mjs` serves the production build over one append-only event log
in SQLite (`runtime-state/state.db`). It is the host code; the library itself
persists nothing.

```sh
cd fixture
npm run build
PROMPTQL_PLATFORM_API_URL=https://your-platform-api \
PROMPTQL_THREAD_ID=your-owning-bot-id \
PORT=5190 node server.mjs
```

### How a review works

- Posting saves a comment immediately; other viewers receive it within a poll (4 seconds).
- Type `@`, choose a participant with arrows/Enter or click/tap, and insert a badge. Tab navigates normally. Backspace/Delete and undo use ordinary editor behavior. Pasted text is never a recipient.
- **Adding the bot directly invokes it to act on that particular discussion.** The configured bot name and `promptql` search alias refer to the same bot.
- “Post directly to {bot name}” starts unchecked. Selecting an inline bot badge checks and disables it; the tooltip explains how to remove the mention. Removing the last bot badge restores the manual choice. Either route still sends one message with one canonical bot mention in the receipt's For row.
- Saved bot-directed comments show a bot badge before the complete comment body, including any original inline badges. This is a rendering of saved invocation intent, not a second recipient or send.
- Posting the first comment keeps its saved discussion open, just like a reply. A failed save retains the draft.
- Compact popups sit above the visible blue toolbar, including when a Refresh control appears. Toggle hover styling is limited to hover-capable fine pointers; keyboard focus stays visible.
- Human-only mentions notify those people without invoking the bot. Plain comments, human status changes and bot contributions send no chat message.
- A chat receipt contains the discussion/app link, selected recipients, and the submitted comment verbatim. No periodic nudges, Sync now, read acknowledgments or background context posts.
- “Waiting for {bot name}…” remains until the next substantive bot contribution in that discussion or the corresponding send error. It is not a runtime-status indicator and has no timeout.
- Sending makes **one attempt**, with the submitting visitor's current credentials, after durable save. All send failures, including uncertain transport outcomes, say: **“Sending failed, ping {bot name} in chat to retry.”** The error is appended to the discussion. No retry button, automatic retry, resend queue or reconciliation.
- A chat retry is a fresh request to the bot, which reads the existing discussions; the user need not find a discussion link. It is not an automatic replay as the original reviewer. A human-notification retry must explicitly ask for that notification.
- Save failures are separate: the composer retains its draft and does not send. An unconfirmed response can still mean a save or send reached the server; never promise exactly-once external delivery.
- Presence and build polling remain. Browser polling uses a transport sequence; **the library has no bot read cursor**.
- The bot uses `anno.mjs read`, `reply`, `resolve`, and `reopen`. Complete reads have no side effects; bot writes use a VM-only Unix socket (mode 0600).

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PROMPTQL_PLATFORM_API_URL` | yes | — | Unversioned Platform API URL |
| `PROMPTQL_THREAD_ID` | yes | — | Owning bot ID |
| `PORT` | no | `5190` | HTTP port |
| `PROMPTQL_TIMEZONE` | no | `UTC` | Message timezone |
| `BOT_NAME` | no | `PromptQL` | Name for bot-authored log events; set to the configured name |
| `ANNO_APP_TITLE` | no | `Live commenting` | Receipt's app title |
| `ANNO_APP_URL` | standalone only | — | Canonical published app URL when no trusted gateway origin is supplied |
| `POLL_MS` | no | `4000` | Collaboration/presence/build polling interval |
| `PRESENCE_GRACE_MS` | no | `2000` | Presence grace beyond the poll interval |
| `PRESENCE_TTL_MS` | no | poll + grace | Test override; use longer than polling |
| `BUILD_ID` | no | startup timestamp | Changed on rebuild/restart; old tabs must refresh before posting |
| `MAX_BODY_BYTES` | no | `16384` | Maximum serialized comment body; never silently truncate |
| `ANNO_DIST` | no | `dist` | Static production build |
| `ANNO_DATA` | no | `runtime-state` | Persistent SQLite directory |
| `ANNO_SOCK` | no | data directory + `anno.sock` | Bot's Unix socket |
| `CDP_URL`, `CHROME_PATH`, `HEADED`, `TEST_OUTPUT_DIR` | tests only | see browser helper | Browser/test settings |

The old `SYNC_MAX_AGE_MS`, `SYNC_MAX_COUNT`, `ANNO_CLI` and `BOT_COMMENTS` controls are removed.

### HTTP and trust boundary

- `GET /readyz`: local readiness, no visitor required.
- `GET /api/state`: consent probe, viewer identity, complete history, protocol version, presence/build.
- `GET /api/directory`: eligible current-bot participants plus configured synthetic bot. Profiles use `thread_participants.promptql_user`; no service accounts or inactive/removed users. No server-shared directory cache.
- `GET /api/events?since=N`: collaboration feed, presence/build; no acknowledgment.
- `POST /api/event`: `{protocol:5,id,thread_id,kind,body?,refs?,pin?,notify_bot?}`. `201` on save; same ID/same complete payload replays without resending (`200`); changed payload/actor conflicts (`409`). Old protocol clients must refresh. Response may include `error_event`/`send_error` while the saved comment succeeds.
- Only the server creates error events; public clients cannot stamp bot authorship.
- Unix socket: `GET /read` returns every event and all discussion summaries, including resolved/unanchored. `POST /event` appends a trusted bot reply/status, with optional `expected_seq` concurrency guard.

The gateway strips client-supplied identity/forwarding headers and injects the visitor token plus canonical isolated app origin (`x-forwarded-host`/`x-forwarded-proto`). The server uses this origin for `anno_discussion`/`anno_event` deep links; it never guesses the app domain or uses a permalink-page fragment. Login preserves the app path/query. Standalone hosts must provide `ANNO_APP_URL` and a trusted authenticating proxy; **never expose this server's API directly to untrusted callers capable of forging these headers**.

Every platform call uses the request's visitor token. No JWT is saved in the environment, database, browser state or directory cache. Recipient eligibility is revalidated under that visitor before save. Only selected semantic recipients generate canonical tags in the receipt's For row; all quoted text is rendered as inert literals, not scanned for recipients.

`runtime-state/state.db` is persistent and gitignored. The v5 startup transaction preserves existing event sequence, source IDs, bodies, anchors and authors, expands event kinds, and removes obsolete read/nudge state. Back it up before upgrading. Never restore an empty fixture database over live comments.

To publish, declare an app artifact (`X-PromptQL-Artifact-Type: app`) pointing
at the VM and port the server listens on:

```json
{
  "version": 2,
  "host": "vm",
  "sandbox_id": "<the VM's sandbox id>",
  "kind": "web",
  "port": 5190,
  "protocol": "http",
  "readiness": {"path": "/readyz"},
  "required_permissions": {"promptql_graphql": "read_write"}
}
```

Publishing does not start the service — run it as a persistent unit, e.g.:

```ini
[Unit]
Description=Live commenting review server
After=network.target
[Service]
WorkingDirectory=/path/to/collaborative-html-annotation/fixture
EnvironmentFile=/path/to/app.env
ExecStart=/usr/bin/env node server.mjs
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
```

**Deploying an update** — the server reads `BUILD_ID` (and every other variable)
once at start, and tabs learn about a new build only from the id the server
returns, so a rebuild is not live until the server restarts:

```sh
cd fixture && npm ci && npm run build          # new dist/
sed -i "s/^BUILD_ID=.*/BUILD_ID=$(git rev-parse --short HEAD)/" /path/to/app.env   # or a timestamp
sudo systemctl restart <unit>                  # picks up dist/ and BUILD_ID; open tabs show the red ⟳ within a poll
```

Restart even if you do not set `BUILD_ID` (the start time then changes the id). Skipping
the restart leaves tabs on the old bundle with no signal. `runtime-state/` is untouched
by a restart — comments and event history persist.

A visitor must open the published app and grant the declared permissions; a
direct localhost browser has no gateway-injected identity and cannot comment.

### Testing the review app

```sh
cd fixture && npm run build
node scripts/check-server.mjs        # server + anno.mjs, fake platform API, no browser
node scripts/check-shared-app.mjs    # two reviewers + the bot in a real browser, fake platform API
```

Both start their own server on a temporary state directory and a fake Platform
API that answers directory/consent queries and `send_thread_message`; nothing reaches a
real bot. Neither exercises the hosted sign-in / visitor-consent exchange; that
is a manual step: open the published app, invoke the bot in a comment, and inspect `anno.mjs read`
on the VM.

## Packaging

```sh
cd fixture
npm run build:library
(cd lib && npm pack)
```

Exports: `collaborative-html-annotation`, `…/anno` (zero-import attribute
helper), `…/review` (DOM-free `flattenAnnotations`), `…/events` (DOM-free
`applyEvent` / `foldEvents` / `diffDoc`), `…/annotations.css`. Peer dependencies: React 19, React DOM 19,
`@floating-ui/react` 0.27. See `INSTRUCTIONS.md` §11.

## Fixture review exercises — revert before committing

When testing live commenting by requesting changes to the **demo document**,
revert those exercise edits before making a Git commit. Keep the actual library
fixes and regression tests. Preserve the live SQLite event log, comment history
and discussion statuses: reverting demo content must never reset review data.

## Derived files — regenerate, don't commit

| Path | Regenerate with |
|---|---|
| `fixture/node_modules/` | `npm ci` |
| `fixture/lib/` | `npm run build:library` |
| `fixture/dist/` | `npm run build` |
| `fixture/*.png`, `fixture/test-output/` | the check suites (screenshots, JSON reports) |
| `fixture/runtime-state/` | the review server (shared state — project data, not source) |
| `*.tsbuildinfo` | `tsc` |

The committed image assets under `fixture/public/` are real fixture data:
`reference-screenshot.svg` backs planted case 5, and
`image-annotation-example.{svg,png}` back the raster region example (the PNG is
committed so no image-generation dependency is needed to build).

## Runtime state in the development fixture

| | |
|---|---|
| key | `annotation-fixture-doc` |
| empty value | `{"version":1,"threads":[]}` |

The fixture boots to an empty document; the check suites clear the key and
start from empty, so a run never depends on prior state.

**Reset:** the *clear all* button on the inspector's **document** tab, or

```js
localStorage.removeItem('annotation-fixture-doc'); location.reload();
```

**Seed** a populated document (paste into the console, then reload):

```js
localStorage.setItem('annotation-fixture-doc', JSON.stringify({
  version: 1,
  threads: [{
    id: 't1',
    refs: [{
      kind: 'anno_id',
      id: 'wireframe.composer.send',
      label: 'Send comment',
      semantic: { kind: 'action' },
    }],
    pin: { xPct: 0.5, yPct: 0.5 },
    status: 'open',
    comments: [{
      id: 'c1',
      author: { id: 'ada', name: 'Ada Okonjo' },
      createdAt: new Date().toISOString(),
      body: [{ kind: 'text', value: 'Should this be the primary action?' }],
    }],
  }],
}));
```

A ref whose `id` does not exist in the artifact exercises the unanchored tray
and shows that the snapshotted `label`/`semantic` keep the comment readable with
no element to point at. Full schema in `INSTRUCTIONS.md` §7 and §11.

## Operational limits

- Live sharing is by polling (4 s), not push; a tab in the background stops
  polling until it is visible again.
- A successful send means platform acceptance, not completed bot work. Delivery errors do not prove non-delivery; no automatic retry is attempted.
- Read the whole history with `anno.mjs read` on each owning-bot interaction. There is no bot read cursor.
- The socket assumes the app runs on the owning bot's VM. The integration must keep its absolute CLI path in durable bot instructions.
- Real notification delivery and a logged-in authorization round-trip require a consenting live test; isolated suites do not establish those outcomes.
- The review server is a small single-process, SQLite-backed host, not a
  horizontally scaled persistence service.
