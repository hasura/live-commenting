# Live commenting

A commenting layer for generated HTML artifacts. Reviewers leave discussions
anchored to parts of a document — a card, a table cell, a phrase in a paragraph,
a rectangle on an image — and the comments survive regeneration of the artifact
because they anchor to declared identity, not to DOM position. The owning
[PromptQL](https://promptql.io) bot reads the complete history from its shell
and acts when a reviewer mentions it.

> **Which file?** This `README.md` says what live commenting is and how the
> pieces fit. `INSTRUCTIONS.md` is for an agent **adding live commenting to an
> app artifact**. `AGENT.md` is for an agent **changing this repository**. Put
> new documentation in the file whose reader needs it; there are no other docs.

| File | Read it for |
|---|---|
| `INSTRUCTIONS.md` | Making an artifact commentable, end to end: what a bot VM needs, the `data-anno-*` contract, choosing ids, mounting the layer, the document schema, publishing the review app, the bot's `anno.mjs`, standing instructions |
| `AGENT.md` | Working on the library: repository layout, the development harness, the check suites, the reference fixture and its planted hit-test cases, what to regenerate rather than commit |
| `CHANGELOG.md` | What changed between versions of the model (v4 → v5) |
| `fixture/THIRD_PARTY_NOTICES.md` | Licences of the dependencies bundled into the tarball |

## How it works

The artifact and the annotation layer are kept strictly apart:

- The **artifact** emits `data-anno-*` attributes (id, label, optional mode and
  semantic payload) and nothing else. `fixture/src/anno.ts` is the whole
  artifact-side contract and has zero imports by design, so an artifact never
  depends on the commenting runtime.
- The **annotation layer** (`fixture/src/annotations/`, packaged as
  `live-commenting`) mounts separately, reads those attributes off the DOM, and
  renders pins, outlines, highlights and discussions. It is controlled: the host
  owns the annotation document.
- The **review app** (`fixture/server.mjs`) is the host: it serves the built
  artifact, keeps one append-only event log in SQLite, shares every comment with
  other viewers within a poll, and delivers `@`-mentions to the bot as a single
  chat receipt. The bot reads and writes discussions through `scripts/anno.mjs`
  over a local Unix socket.

Live commenting works inside an **app artifact** — a server on the bot's VM
published through the PromptQL gateway, which authenticates each viewer. A bare
`file` artifact (an uploaded `.png`, a static HTML page) cannot be commented; to
review an image, render it inside an app.

### What a review looks like

- Posting saves a comment immediately; other viewers receive it within a poll (4 seconds by default).
- Type `@` to mention a participant. **Mentioning the bot invokes it on that discussion**; "Post directly to {bot name}" does the same without an inline mention. Human-only mentions notify those people without invoking the bot. Plain comments, status changes and bot contributions send no chat message.
- The bot receives one chat receipt — discussion link, recipients, the comment verbatim — sent once, after the comment is durably saved, with the submitting viewer's credentials. If sending fails the discussion shows "Sending failed, ping {bot name} in chat to retry."; there is no automatic retry.
- "Waiting for {bot name}…" stays on a discussion until the bot's next contribution to it.
- Discussions can be resolved and reopened by people or by the bot; comments are immutable and never deleted. Discussions whose target has disappeared from the artifact are kept in an *unanchored* tray, still readable and resolvable.
- "Viewing now" shows who currently has the app open. Presence is not bot membership.
- Below 480 CSS px the popups become bottom sheets above the toolbar; Enter/dismiss behaviour follows the device, not the width.

## Requirements

- Node 22.12 or newer — Vite 7's minimum, and `node:sqlite` for the review server. Tested on Node 24, which the PromptQL v2 VM ships.
- A Chromium-family browser only for the check suites (see `AGENT.md`). Nothing downloads one.

## Build

```sh
cd fixture
npm ci
npm run typecheck        # tsc -b --noEmit
npm run build            # tsc -b && vite build → fixture/dist/ (what server.mjs serves)
npm run build:library    # → fixture/lib/ and live-commenting-<version>.tgz
```

Some npm versions block postinstall scripts by default; `esbuild` needs one.
`package.json` whitelists it under `allowScripts` — if your npm ignores that
field it prints the command to approve it (on npm 11, `npm approve-scripts esbuild`).

## Run locally

```sh
cd fixture
npm run dev              # http://localhost:5180
```

This runs the **same code path as production**: `server.mjs` with a SQLite
event log on a fresh temporary directory, Vite serving the UI with hot reload
and proxying `/api` to it, and a fake platform in place of PromptQL. You are
signed in as a fixed development identity; the directory offers one other
reviewer and the bot; every chat receipt the server would send is printed to
the terminal instead. The bot's socket is `fixture/dev.sock`:

```sh
ANNO_SOCK=dev.sock node scripts/anno.mjs read
ANNO_SOCK=dev.sock node scripts/anno.mjs reply <discussion-id> 'Reply text'
```

State is discarded when the harness stops. The dev inspector (bottom right)
shows what the artifact declares and the live document folded from the log.
`npm run dev:ui-only` starts bare Vite without a server — the app then loads but
cannot sign in or comment; it is only useful for the harness-page suites.

## The review app

`fixture/server.mjs` serves the production build over one append-only event log
in SQLite (`runtime-state/state.db`). It is the host code; the library itself
persists nothing.

```sh
cd fixture && npm run build
PROMPTQL_PLATFORM_API_URL=https://your-platform-api \
PROMPTQL_THREAD_ID=your-owning-bot-id \
BOT_NAME='Your Bot' PORT=5190 node server.mjs
```

`INSTRUCTIONS.md` §0 walks through publishing it from a bot VM (environment
file, systemd unit, the app-artifact declaration, updating a running app).

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PROMPTQL_PLATFORM_API_URL` | yes | — | Unversioned Platform API URL |
| `PROMPTQL_THREAD_ID` | yes | — | Owning bot ID |
| `PORT` | no | `5190` | HTTP port |
| `PROMPTQL_TIMEZONE` | no | `UTC` | Message timezone |
| `BOT_NAME` | no | `PromptQL` | The project's configured bot name — used for bot-authored events and in the UI |
| `ANNO_APP_TITLE` | no | `Live commenting` | App title in the chat receipt |
| `ANNO_APP_URL` | standalone only | — | Canonical published app URL when no trusted gateway origin is supplied |
| `POLL_MS` | no | `4000` | Collaboration/presence/build polling interval |
| `PRESENCE_GRACE_MS` | no | `2000` | Presence grace beyond the poll interval |
| `PRESENCE_TTL_MS` | no | poll + grace | Test override; use longer than polling |
| `BUILD_ID` | no | startup timestamp | Changes on rebuild/restart; old tabs must refresh before posting |
| `MAX_BODY_BYTES` | no | `16384` | Maximum serialized comment body; never silently truncated |
| `ANNO_DIST` | no | `dist` | Static production build |
| `ANNO_DATA` | no | `runtime-state` | Persistent SQLite directory |
| `ANNO_SOCK` | no | `<ANNO_DATA>/anno.sock` | The bot's Unix socket |

### HTTP and trust boundary

- `GET /readyz`: local readiness, no visitor required.
- `GET /api/state`: consent probe, viewer identity, complete history, protocol version, presence and build.
- `GET /api/directory`: mentionable participants of the owning bot plus the bot itself. Profiles come from `thread_participants.promptql_user`; no service accounts or inactive users; nothing is cached across viewers.
- `GET /api/events?since=N`: collaboration feed with presence and build; no acknowledgment.
- `POST /api/event`: `{protocol:5,id,thread_id,kind,body?,refs?,pin?,notify_bot?}`. `201` on save; the same id with the same payload replays without resending (`200`); a changed payload or actor conflicts (`409`). Old-protocol clients must refresh. The response may carry `error_event`/`send_error` while the saved comment succeeds.
- Only the server creates error events; public clients cannot stamp bot authorship.
- Unix socket (mode 0600): `GET /read` returns every event and all discussion summaries, including resolved and unanchored. `POST /event` appends a trusted bot reply or status change, with an optional `expected_seq` concurrency guard.

The gateway strips client-supplied identity/forwarding headers and injects the
visitor token plus the canonical isolated app origin (`x-forwarded-host`,
`x-forwarded-proto`). The server uses that origin for `anno_discussion` /
`anno_event` deep links and never guesses the app domain. Standalone hosts must
provide `ANNO_APP_URL` and a trusted authenticating proxy; **never expose this
server's API to callers that could forge these headers**.

Every platform call uses the request's visitor token. No JWT is stored in the
environment, the database, browser state or the directory. Recipient
eligibility is revalidated under that visitor before save. Only selected
recipients become tags in the receipt's For row; quoted text is inert.

`runtime-state/state.db` is persistent and gitignored. The v5 startup
transaction preserves existing event sequence, ids, bodies, anchors and authors,
and removes the obsolete v4 read/nudge state. Back it up before upgrading, and
never restore an empty database over live comments.

## Packaging

```sh
cd fixture
npm run build:library    # fixture/lib/ + live-commenting-<version>.tgz
```

Exports: `live-commenting` (the layer), `live-commenting/anno` (zero-import
attribute helper), `live-commenting/review` (DOM-free `flattenAnnotations`),
`live-commenting/events` (DOM-free `applyEvent` / `foldEvents` / `diffDoc`),
`live-commenting/annotations.css`. Peer dependencies: React 19, React DOM 19,
`@floating-ui/react` 0.27. The package is not published to a registry; install
the tarball. Bundled dependency licences are in `fixture/THIRD_PARTY_NOTICES.md`.

## Operational limits

- Live sharing is by polling, not push; a background tab stops polling until it is visible again.
- A successful send means the platform accepted the message, not that the bot has acted. A send error does not prove non-delivery; nothing is retried automatically.
- The bot reads the whole history with `anno.mjs read` on each interaction. There is no bot read cursor.
- The socket assumes the app runs on the owning bot's VM; the bot's standing instructions must carry the CLI's absolute path.
- The review server is a small single-process, SQLite-backed host, not a horizontally scaled service.