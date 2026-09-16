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
bot is just another reader: it is nudged when comments have been waiting, pulls
them from its shell, and can resolve threads the same way.

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
  scripts/anno.mjs                    the bot's CLI: unread / threads / resolve / reopen over the Unix socket
  scripts/browser.mjs                 browser resolution shared by the suites
  scripts/check-fixture.mjs           artifact contract + planted-case geometry (20 assertions)
  scripts/check-annotations.mjs       the annotation layer, end to end (46 assertions)
  scripts/check-advanced.mjs          real text/region gestures, quotes, event-log helpers, IME, popovers (24)
  scripts/check-ergonomics.mjs        touch, keyboard, focus, event folding, hide overlays (12)
  scripts/check-image-example.mjs     raster image-region annotation example (15)
  scripts/check-server.mjs            review server + anno.mjs against a fake platform API, no browser (43)
  scripts/check-shared-app.mjs        two reviewers + the bot, real browser + server, fake platform API (25)
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

- A reviewer posts a comment → `POST /api/event` → it is in the log and visible
  to every other open tab within a poll (4 s). There is no draft, no Save all,
  no publish step. Comments are immutable; the only lifecycle is resolve/reopen.
- Every reader is a cursor into the log. Browser tabs poll `since=<seq>`; the
  owning bot has two cursor rows: `nudged` (what it has been told about) and
  `pulled` (what it has actually read).
- **The bot is nudged, then reads for itself.** When the oldest comment the bot
  has not been nudged about is 2 minutes old (`SYNC_MAX_AGE_MS`), or 50 such
  comments are pending (`SYNC_MAX_COUNT`), the poll response says `sync.due` and
  whichever open tab sees it calls `POST /api/sync-now` — or a reviewer clicks
  **Sync now**. The server posts **one short `send_system_message`** to the
  bot — a doorbell: `Review nudge <id> · 3 new messages from Alice, Bob …` plus
  the instruction to run `node <abs path>/scripts/anno.mjs unread` and reply
  only with `Read N messages.` and a short summary. No comment text travels in
  the message; the bot pulls the log. A `message_id` back advances `nudged`;
  `pulled` moves only when the bot runs `unread`. A failed send leaves both, and
  the next `due` re-nudges. Because `due` is measured against `nudged`, a busy
  bot gets exactly one doorbell per new batch, and a bot that pulls first never
  gets a stale one. There is no unattended send: the server never acts without a
  visitor's request in hand.
- **Other people's comments arrive without ceremony.** They appear as pins and
  in open popovers within a poll, plus one toast ("new comment from Alice", with
  **Jump**) for events by others; your own other tabs are merged silently. The
  commenting bar shows how many people are viewing right now (👥, names in the
  tooltip). If the app is rebuilt underneath an open tab, a red ⟳ appears in the
  bar — comments are in the log, not the bundle, so refreshing loses nothing.
- **The bot reads and writes from its shell** with `scripts/anno.mjs`, over a
  Unix socket (`runtime-state/anno.sock`, mode 0600) that only processes on the
  VM can open. `anno.mjs unread` prints everything past its `pulled` cursor and
  advances both cursors — it is the only way comments reach the bot, and **the
  bot runs it before beginning any work, every interaction**, so nothing is lost
  when no tab was open to nudge. `anno.mjs resolve <thread-id> [note]` is
  one call, one event: reviewers see "✓ Resolved by <bot>" inline within a poll
  and can reopen.

### Environment variables

The complete list. The server reads the first block; everything else is used only
by the check suites.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PROMPTQL_PLATFORM_API_URL` | yes | — | Platform API base URL; the server calls `$URL/v1/graphql` |
| `PROMPTQL_THREAD_ID` | yes | — | The owning bot: where nudges are sent |
| `PORT` | no | `5190` | TCP port the review server listens on |
| `PROMPTQL_TIMEZONE` | no | `UTC` | IANA time zone for digest timestamps and the `send_system_message` `timezone` |
| `BOT_NAME` | no | `Hasura Bot` | Display name for the bot's own events ("Resolved by …") |
| `SYNC_MAX_AGE_MS` | no | `120000` | A nudge is due once the oldest comment the bot has not been nudged about is this old (2 min; keep it under the VM's 15-minute idle window) |
| `ANNO_CLI` | no | `<server dir>/scripts/anno.mjs` | Absolute path to `anno.mjs` quoted in the nudge message |
| `PRESENCE_TTL_MS` | no | `15000` | A viewer counts as "viewing now" for this long after their last poll |
| `BUILD_ID` | no | unset | Override the served-app build id (default: hash of `dist/index.html`) that tabs compare to offer a refresh |
| `ANNO_DIST` | no | `dist` | Directory the static app is served from (the suites point it at a private copy) |
| `SYNC_MAX_COUNT` | no | `50` | …or once this many user events are pending |
| `MAX_BODY_BYTES` | no | `4096` | Per-comment body cap (`413` above it) |
| `BOT_COMMENTS` | no | unset | Set to `1` to let `anno.mjs` post comments as the bot (off in v1) |
| `ANNO_DATA` | no | `runtime-state` | Directory for `state.db` and the socket |
| `ANNO_SOCK` | no | `$ANNO_DATA/anno.sock` | Path of the bot's Unix socket (also read by `anno.mjs`) |
| `CDP_URL` | tests only | `http://127.0.0.1:9222` | Chrome DevTools endpoint the browser-driven suites attach to |
| `CHROME_PATH` | tests only | auto | Browser binary for the suites that launch their own browser |
| `HEADED` | tests only | unset | Set to `1` to run those suites with a visible window |
| `TEST_OUTPUT_DIR` | tests only | `test-output` | Where the suites write screenshots and JSON reports |

Never put a user's JWT in the environment — see the token note below. Using the
library itself needs no environment at all; that is covered in `INSTRUCTIONS.md`.

- `GET /readyz` — unauthenticated, `204` once local startup checks pass.
- `GET /api/state` — the visitor's identity, the whole log, and the bot-sync
  status. The one place the visitor's platform consent is probed.
- `GET /api/events?since=<seq>` — events after `seq`, plus `sync`
  (`pending`, `unread`, `due`, `dueAt`, `lastNudgedAt`, `lastPulledAt`, …), `presence` (`count`, `viewers`:
  everyone who polled within `PRESENCE_TTL_MS`, per person) and `build` (the
  served app's build id). Polled every 4 s by visible tabs. `/api/state` carries
  the same three.
- `POST /api/event` — `{id, thread_id, kind, body?, refs?, pin?}`; `201 {seq, event}`.
  Idempotent on `id` (a replay is `200`). Author is stamped from the token.
  `kind` is `comment`, `resolve` or `reopen`; a no-op resolve/reopen is `409`.
- `POST /api/sync-now` — nudge the bot about everything past its `nudged`
  cursor with one short system message, acting as the caller. `200` with the
  receipt (`status: nudged|nothing`); `204` when another tab's nudge is already
  in flight; `502` when the platform refused (cursors unchanged).

The bot's socket (`runtime-state/anno.sock`) speaks the same shapes:
`GET /events?since=`, `GET /threads?status=open|resolved|all`, `GET /unread`,
`POST /unread/ack {to_seq}` (advances `pulled` and `nudged`), `POST /event {kind, thread_id, note?, id?}`
(`actor_kind` forced to `bot`). `scripts/anno.mjs` wraps it.

Every `/api` request must carry an `X-PromptQL-Visitor-Token` header; the
PromptQL gateway injects it for visitors of a published app artifact, and the
server forwards it as the bearer token on each platform call — read from that
request, never cached, never sent to the browser. Comment authorship is taken from
the token's `sub` on the server; anything the client claims about identity is
ignored. **Never put a user's JWT into the app's environment** — the server holds
only the platform URL and the owning bot ID, and it never acts on its own: every
platform call is made with the token of the request that caused it. The event
log, cursors and nudge receipts live in `fixture/runtime-state/state.db`
(gitignored); keep that directory across deployments. A v0.3.0/0.3.1 database
(single `bot` cursor, `sent` receipts) is migrated in place on start.

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
Description=Collaborative annotation review
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

A visitor must open the published app and grant the declared permissions; a
direct localhost browser has no gateway-injected identity and cannot comment.

### Testing the review app

```sh
cd fixture && npm run build
node scripts/check-server.mjs        # 43 — server + anno.mjs, fake platform API, no browser
node scripts/check-shared-app.mjs    # 25 — two reviewers + the bot in a real browser, fake platform API
```

Both start their own server on a temporary state directory and a fake Platform
API that answers the consent probe and `send_system_message`; nothing reaches a
real bot. Neither exercises the hosted sign-in / visitor-consent exchange; that
is a manual step: open the published app, comment, and watch `anno.mjs unread`
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
- Delivery of a nudge is the send, not the bot's reply: it is marked nudged
  when `send_system_message` returns a `message_id`. An ambiguous send is simply
  re-nudged under a new batch id — a duplicate doorbell is harmless.
- Nothing is sent while no tab is open; the bot catches up with
  `anno.mjs unread` at the start of its next interaction — the same command the
  nudge tells it to run.
- The nudge assumes the app runs on the owning bot's VM (the bot must be able to
  reach the Unix socket). Comment bodies are capped; digests are not split.
- Comment text is stored as data and rendered as text, never executed as HTML.
- The review server is a small single-process, SQLite-backed host, not a
  horizontally scaled persistence service.
