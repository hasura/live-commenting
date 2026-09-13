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
regions, immutable sent review rounds, a DOM-free semantic flattener for
prompting, and explicit revision helpers (`readManifest` / `applyRevision`) for
regenerated content. A reference **review app** (`fixture/server.mjs`) shows the
layer wired to a host that saves shared state and delivers each round to a
[PromptQL](https://promptql.io) bot as an app artifact.

## Documentation

| File | Read it for |
|---|---|
| `INSTRUCTIONS.md` | Making an artifact commentable and mounting the layer — attributes, id scheme, document schema, custom composers, text/region/round/revision APIs, packaged consumption |
| `fixture/README.md` | The reference fixture: why it is shaped the way it is, the planted hit-test cases, the overlay positioning rule |

## Repository layout

```
INSTRUCTIONS.md                       how to use the library
fixture/                              Vite + React 19 + TypeScript
  src/anno.ts                         artifact-side contract (zero imports)
  src/annotations/                    the annotation layer — no dependency on fixture/, packaged as-is
    review.ts                         DOM-free: closeRound, flattenAnnotations
    manifest.ts                       readManifest / applyRevision for regenerated content
    selection.ts                      text-range and image-region selection
  src/fixture/                        the reference artifact the layer is developed against
  src/dev/                            dev inspector (development build only)
  src/App.tsx                         host: dev fixture (localStorage) or shared review app (/api)
  server.mjs                          production review app: static build + /api/state + /api/save
  scripts/browser.mjs                 browser resolution shared by the suites
  scripts/check-fixture.mjs           artifact contract + planted-case geometry (20 assertions)
  scripts/check-annotations.mjs       the annotation layer, end to end (46 assertions)
  scripts/check-advanced.mjs          real text/region gestures, quotes, revision helpers, IME, popovers (23)
  scripts/check-ergonomics.mjs        touch, keyboard, focus, manifest extraction, hide overlays (13)
  scripts/check-image-example.mjs     raster image-region annotation example (15)
  scripts/check-save-guard.mjs        Save all UI guards with mocked network failures (8)
  scripts/check-save-isolated.mjs     review app end to end against a fake upstream platform API (8)
  scripts/check-recreated-app.mjs     read-only checks of a running review app with a real token (11)
  scripts/check-app.mjs               live Save all — has a real external side effect (12)
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

`server.mjs` imports `./lib/review.js`, so build the library before the app when
running the review server.

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

Click **Comment** in the full-width blue review header. Click or tap selects the
nearest declared element; dragging selects a text range (on `mode="text"`
targets) or a rectangle (on `mode="region"` targets); `Alt+Enter` annotates an
existing native text selection. `Enter` posts, `Shift+Enter` newlines, `Esc`
minimizes without discarding text. Use **Resume draft** to continue or **Cancel** to discard. Compact views use a footer composer; wider/taller views retain an anchored popover.

## Test

All suites drive a real Chromium-family browser through `playwright-core`. They
need the **dev server already running on 5180** (the app suites need the review
server instead — see below).

```sh
cd fixture
npm run dev -- --host 0.0.0.0 --port 5180 --strictPort &

node scripts/check-fixture.mjs         # 20 assertions
node scripts/check-annotations.mjs     # 48
node scripts/check-advanced.mjs        # 23
node scripts/check-ergonomics.mjs      # 15
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

`fixture/server.mjs` serves the production build and adds a small shared-state
API for a team review. It is the host code; the library itself persists nothing.

```sh
cd fixture
npm run build:library && npm run build
PROMPTQL_PLATFORM_API_URL=https://your-platform-api \
PROMPTQL_THREAD_ID=your-owning-bot-id \
PORT=5190 node server.mjs
```

### Environment variables

The complete list. The server reads the first four; everything else is used only
by the check suites.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PROMPTQL_PLATFORM_API_URL` | yes | — | Platform API base URL; the server calls `$URL/v1/artifacts/...` and `$URL/v1/graphql` |
| `PROMPTQL_THREAD_ID` | yes | — | The owning bot: where review artifacts are archived and the summary message is posted |
| `PORT` | no | `5190` | TCP port the review server listens on |
| `PROMPTQL_TIMEZONE` | no | `UTC` | IANA time zone passed with each posted message (`send_thread_message` `timezone`) |
| `PROMPTQL_VISITOR_TOKEN` | tests only | — | A captured `X-PromptQL-Visitor-Token` value for `check-app.mjs` and `check-recreated-app.mjs`; see "Testing the review app" |
| `CDP_URL` | tests only | `http://127.0.0.1:9222` | Chrome DevTools endpoint the browser-driven suites attach to |
| `CHROME_PATH` | tests only | auto | Browser binary for the suites that launch their own browser |
| `HEADED` | tests only | unset | Set to `1` to run those suites with a visible window |
| `TEST_OUTPUT_DIR` | tests only | `test-output` | Where the suites write screenshots and JSON reports |

Never put a user's JWT in the environment — see the token note below. Using the
library itself needs no environment at all; that is covered in `INSTRUCTIONS.md`.

- `GET /readyz` — unauthenticated, `204` once local startup checks pass.
- `GET /api/state` — the shared document, its revision, and the visitor's identity.
- `POST /api/save` — **Save all**: checks the shared revision, snapshots pending
  discussions, generated HTML and manifest, archives the JSON as a file
  artifact on the owning bot, posts the flattened summary as a message to it,
  and locks the round. Idempotent under a Save ID; a stale revision is `409`;
  an unconfirmed delivery is `502` with the Save ID retained for reconciliation.

Every `/api` request must carry an `X-PromptQL-Visitor-Token` header; the
PromptQL gateway injects it for visitors of a published app artifact, and the
server forwards it as the bearer token on each platform call — read from that
request, never cached, never sent to the browser. Comment authorship is taken from
the token's `sub` on the server; anything the client claims about identity is
ignored. **Never put a user's JWT into the app's environment** — the server holds
only the platform URL and the owning bot ID. Shared state and Save-ID receipts live under
`fixture/runtime-state/` (gitignored); keep that directory across deployments.

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
  "required_permissions": {"promptql_graphql": "read_write", "artifacts": true}
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
direct localhost browser has no gateway-injected identity and cannot save.

### Testing the review app

```sh
# fake-upstream, temporary state — safe anywhere; needs a CDP browser
PROMPTQL_THREAD_ID=any-id node scripts/check-save-isolated.mjs   # 8

# against a running server on 5190
node scripts/check-save-guard.mjs                                # 8, mocks /api/* only
PROMPTQL_VISITOR_TOKEN=… node scripts/check-recreated-app.mjs    # 11, read-only
PROMPTQL_VISITOR_TOKEN=… node scripts/check-app.mjs              # 12, REAL side effect
```

`check-app.mjs` performs one real Save all: it archives an artifact and posts a
labelled QA message to the owning bot. Do not run it against a review that has
unsent work. `check-recreated-app.mjs` expects a particular saved history (four
rounds) and is a template to adapt rather than a generic suite. None of these
exercise the hosted sign-in / visitor-consent exchange; that is a manual step.

`PROMPTQL_VISITOR_TOKEN` must be a real `X-PromptQL-Visitor-Token` value captured
from a request the gateway made to the published app (for example, logged once by
a temporary debug handler while you open the app). It is **not** the VM shell's
`PROMPTQL_USER_JWT`: that token is short-lived and identifies whoever ran the shell,
so using it makes the test act as the wrong person and stop working when it expires.

## Packaging

```sh
cd fixture
npm run build:library
(cd lib && npm pack)
```

Exports: `collaborative-html-annotation`, `…/anno` (zero-import attribute
helper), `…/review` (DOM-free `closeRound`, `flattenAnnotations`),
`…/annotations.css`. Peer dependencies: React 19, React DOM 19,
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
| artifact version | `spec-v0.3` (the `VERSION` constant in `App.tsx`) |
| empty value | `{"version":1,"artifactVersion":"spec-v0.3","threads":[]}` (`rounds` is optional and appears once a round is sent) |

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
  artifactVersion: 'spec-v0.3',
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

- Shared save/reload, not realtime multi-user editing; a conflict preserves the
  local draft for download and merging is manual.
- An ambiguous delivery is deliberately blocked under its Save ID; inspect the
  receipt and the matching bot message before deciding recovery — never retry
  blindly under a new ID.
- Archived history is stored as JSON data and never executed as HTML.
- The review server is a small single-process, file-backed host, not a
  horizontally scaled persistence service.

## Desktop/mobile review lab

See [`fixture/LAB.md`](fixture/LAB.md) for the three-artifact baseline/candidate
comparison setup, screenshots, touch-emulation limitations and safe simulated
sending. The candidate's shared library adds a full-width blue header, compact
footer discussion/composer, host-reported layout insets and sending status, and
minimize/resume draft handling.

Existing hosts must integrate `onLayoutChange` to reserve space and offset their
sticky headers. See `INSTRUCTIONS.md` §6 and §12. The document schema and backend
are unchanged. Already-built artifacts do not update automatically.

After starting the lab:
```sh
cd fixture
node scripts/check-responsive-review.mjs  # 3 artifacts × 6 viewports
node scripts/check-review-lifecycle.mjs   # draft / resize / simulated sending
node scripts/check-lab-embedded.mjs       # iframe isolation + resizing
node scripts/check-review-performance.mjs # local diagnostic, not a benchmark
```

This is a review candidate, not a new published package release. Physical
iOS/Android QA, touch selection/region gesture redesign and off-slide navigation
remain follow-ups. The implementation and usage instructions live together here;
a matching product-wiki update must accompany release.
