# Working on this repository

> **Which file?** This `AGENT.md` is for an agent **changing this repository** —
> the library, the review server, the fixture, the suites. `INSTRUCTIONS.md` is
> for an agent **adding live commenting to an app artifact**; `README.md` says
> what live commenting is. Put new documentation in the file whose reader needs
> it. Do not add validation reports, audits or design scratch files to the repo:
> what a user or agent needs to succeed goes into one of these three files, the
> rest belongs in the commit message.

## Repository layout

```
README.md, INSTRUCTIONS.md, AGENT.md, CHANGELOG.md
fixture/                              Vite + React 19 + TypeScript; also the review app
  src/chart.ts, chart-adapters.ts      independent chart contracts/geometry bridges, no annotation runtime
  src/anno.ts                         artifact-side contract — zero imports, don't add any
  src/App.tsx                         the host: fetches /api/state, polls /api/events, posts diffDoc events
  src/annotations/                    THE LAYER — no dependency on fixture/, packaged as-is
    index.ts                          public surface
    chart.ts, ChartSelection.tsx       shared selection geometry, live enclosures and historical context
    capture.ts                        original rectangle image capture
    types.ts                          AnnotationDoc (persisted) vs Target/Pin (ephemeral)
    target.ts                         reading data-anno-*, hit-testing, widen chain
    layout.ts                         positioning contexts and clipping — the hard part
    cluster.ts                        pins derived from threads, every frame
    selection.ts                      text-range and image-region selection
    events.ts                         DOM-free: the event log — applyEvent, foldEvents, diffDoc
    review.ts                         DOM-free: flattenAnnotations
    store.ts                          immutable doc helpers + useAnnotations
    Annotations.tsx                   root, toolbar, orchestration
    Overlay.tsx                       containers, outlines, pins
    Thread.tsx                        read / reply / resolve / reopen
    Composer.tsx                      the Tiptap composer, mentions, "Post directly to {bot}"
    PresenceIndicator.tsx             "Viewing now"
  src/fixture/                        THE ARTIFACT the layer is developed against (SpecPage, DecisionTable, Wireframe)
  src/dev/                            development build only, rendered behind import.meta.env.DEV — NOT the layer, NOT host chrome
    DevOverlay.tsx                    target/document inspector
    DevBanner.tsx                     "signed in as" banner for the fake harness identity (styled in styles.css)
  src/styles.css                      fixture styles; rules tagged CASE n are load-bearing
  server.mjs, server/                 review app: static build + SQLite events/snapshots + /api + bot socket
  scripts/anno.mjs                    the bot's CLI over the Unix socket
  scripts/dev-server.mjs              `npm run dev`: fake platform + server.mjs + Vite proxy
  scripts/dev-client.mjs              suite helpers: reset / seed / readDoc against the dev harness
  scripts/browser.mjs                 browser resolution shared by the suites
  scripts/check-*.mjs, audit-*.mjs    the check suites
  scripts/package-library.mjs         emits lib/ (ESM + CSS + declarations + package.json)
  public/                             fixture image assets (committed — see Derived files)
  THIRD_PARTY_NOTICES.md              licences of bundled dependencies
```

## The development harness

`npm run dev` runs `scripts/dev-server.mjs`. There is one host (`App.tsx`) and
it runs the same code in development and production; the harness supplies what
PromptQL supplies in production:

```
Vite :5180 (UI, HMR)  ──/api proxy──▶  server.mjs :5190 (SQLite, socket dev.sock)  ──▶  fake platform (in-process)
```

- The fake platform answers the `thread_participants` directory query with a
  fixed pair of reviewers plus the bot, and logs every `send_thread_message`
  (chat receipt) to the terminal with its `agentResponseConfig`.
- The proxy injects an `x-promptql-visitor-token` for the development identity
  when the request carries none. Send your own header to act as someone else
  (`check-shared-app.mjs` does this with `page.route`).
- The server runs on a fresh temporary `ANNO_DATA` directory. `POST /__dev/reset`
  restarts it on a new empty directory — the suites call this instead of
  clearing state by hand. Stopping the harness discards the state.
- If `dist/` exists, the server serves it on the API port, so the production
  bundle can be checked side by side with the Vite build.

Env: `PORT` (5180), `ANNO_API_PORT` (PORT+10), `HOST`, `ANNO_SOCK` (`dev.sock`),
`BOT_NAME`, `POLL_MS` (1000 in development), `BUILD_ID`, `ANNO_APP_TITLE`.

The dev inspector (`src/dev/`, bottom right in development builds) shows what
the artifact declares — hover a planted case to outline it — and the document
folded from the event log. Nothing in that document tab should be a pixel
measurement, a marker grouping or a visibility flag: only refs, snapshots and comment
bodies. The inspector shares `useLayouts` with the layer rather than
reimplementing positioning, which is why both are right for the same reason.

There is no second persistence path: the review server's event log is the only
one, in development and in production. Don't add one.

## Check suites

All browser suites drive a real Chromium-family browser through
`playwright-core`, which downloads nothing. `scripts/browser.mjs` resolves one,
in order: `$CDP_URL` (attach to a running Chrome), `$CHROME_PATH`, the usual
install locations, then Playwright's `channel: 'chrome'`. `HEADED=1` runs
visibly; `TEST_OUTPUT_DIR` (default `test-output/`) receives screenshots and
JSON reports. A non-zero exit is a real failure; the first `FAIL` line is the lead.

```sh
cd fixture && npm run dev &            # harness on 5180 — required by the first two groups
```

Against the running app (real host, seeded through `dev-client.mjs`):

| Suite | Covers |
|---|---|
| `check-chart-interactions.mjs` | point-badge placement, moving geometry with an unsent reply, and touch rectangle semantics; isolated chart-protocol harness |
| `check-chart-elements.mjs` | title/subtitle, SVG label, legend and control gestures through real SQLite; chart/text gesture ownership and Canvas with an HTML legend |
| `check-capture-alignment.mjs` | centred SVG pie/donut rectangles, coloured pixels and alignment in stored PNGs, reload, and unchanged live layout |
| `check-chart-comments.mjs` | chart gestures, snapshots, source-data revisions, missing/restored members, SVG/Canvas/native adapters, fallback and responsive enclosures; edits and restores `example-data.ts` on the isolated harness |
| `check-chart-examples.mjs` | all six chart examples, renderer/data switches, stable target ids, same-DOM comment round trip and narrow layouts |
| `check-fixture.mjs` | artifact contract + planted-case geometry, overlay alignment after page and inner scroll |
| `check-annotations.mjs` | the layer end to end: comment mode, pins, replies, resolve, unanchored, reload round trip |
| `check-advanced.mjs` | real text/region gestures, quotes, event-log helpers, IME, popovers |
| `check-ergonomics.mjs` | touch, keyboard, focus, hide overlays |
| `check-image-example.mjs` | raster image-region annotation |
| `check-comments-panel.mjs` | unified reader: page ordering, filters, missing/partial refs, markers, draft/scroll retention, navigation and empty states (isolated controlled host) |
| `check-thread-cards.mjs`, `check-mobile-popups.mjs`, `check-popup-interactions.mjs`, `check-compact-toolbar.mjs` | popup/card design language, compact layout, device policy, Comments reader |
| `check-popover-stability.mjs` | the popover stays on its target while its own height changes (mention picker open/filter/close, Escape) and while the host rerenders under an open draft (same-id node replacement, removed and restored target, widen, posting, idle polls) |

Harness pages (a `page.route` serves a minimal page that mounts exported
components from `/src`; still need Vite on 5180):
`check-presence.mjs`, `check-device-integration.mjs`, `check-fixed-headers.mjs`,
`check-mobile-followup.mjs`, `check-resolve-popup.mjs`,
`check-tooltip-behavior.mjs`, `check-typography.mjs`, `check-mentions.mjs`,
`check-mobile-pins.mjs` (device-only marker sizing and matching popup geometry).

Self-contained (start what they need):
`check-server.mjs` (server + `anno.mjs` against a fake platform, no browser),
`check-shared-app.mjs` (two reviewers + the bot, real browser + server),
`audit-layout-input.mjs` (spawns its own harness on 5182),
`check-device-policy.mjs` (pure classifier assertions).

`check-shared-app.mjs` also posts a chart rectangle to the fake bot, opens its
receipt as a second reviewer, retrieves the original PNG through `anno.mjs`,
and verifies the bot's reply reaches the browser. Set `ANNO_DIST` to test a staged
production build. These suites exercise the real integration code against local
platform responses; they do not publish an AppArtifact or exercise the live
PromptQL gateway, consent screen, or agent execution.

Conventions the suites rely on:

- Seed discussions with `seed()` / `resetAndSeed()` from `dev-client.mjs`. Seeds
  are real `/api/event` posts, so ids must satisfy the server's rule
  (`^[a-zA-Z0-9_-]{8,80}$`) — use `qa-thread-…`.
- Read state with `readDoc()` (or `window.__annoDoc()` inside the page): the
  event log folded exactly as the app folds it.
- A save is a network round trip. After posting, wait for the composer to detach
  before asserting on counts.
- The reader defaults to **All**, not Open. Status filtering lives inside the
  reader; marker visibility has its own toolbar control. The reader remains
  mounted (hidden) after close and keeps filtered cards mounted to preserve
  drafts. Scope browser assertions to `.ca-popover` / `.ca-tray:visible` and
  `.ca-thread:visible`, not every matching node in the document.
- **Markers cluster.** Several discussions on one target share a pin with a count,
  and pins from different targets that land too close are merged by proximity
  (`cluster.ts`). Never assert one marker per discussion.
- `check-fixture.mjs` asserts every planted case still holds geometrically, and
  that the overlay/element comparison was non-empty. Keep that: a vacuous pass is
  how a positioning drift once slipped through.

## The reference fixture

The artifact under `src/fixture/` is a product spec that embeds a live wireframe
of a commenting UI. A spec gives real prose (text mode); the wireframe gives a
densely nested interactive UI (block mode) with a legitimate reason to sit
inside that prose — so text and element mode collide on one page, which is
where the interesting bugs are. It covers block, text, and image-region targets;
`check-fixture.mjs` verifies the planted cases against the rendered document.

### Chart examples

`src/fixture/charts/ChartExamples.tsx` appends five chart families below
`SpecPage` in the same `#artifact-root`. Start with the independent `SimpleBar`,
`SimpleLine`, `SimplePie`, `SimpleScatter`, and `RelationshipGraph` components.
`example-data.ts` holds their small synthetic records with explicit stable keys;
edit those records to exercise revisions instead of adding data-editing controls.
Labels are ordinary deterministic JavaScript formatters, never runtime LLM calls.
The eight-node relationship example shares node/link IDs between ECharts force
and Sankey layouts, with SVG/Canvas renderers and crossing-link boundary cases.

`ImageOnlyExample` deliberately imports no data or membership map: its exported
PNG has only an image-region target. This demonstrates the fallback when precise
data selection is unavailable. Rectangles capture an immutable PNG; point
selections capture their stable key, label and values immediately.

The original A–F examples retain their chart/section IDs in advanced
disclosures, mounted so opening/closing preserves controls. Jump links to
`#fixture-A` through `#fixture-F` open their enclosing disclosure. The stress
switch increases B, D and (when enabled) F. WebGL is off by default: F never
creates a context or animation loop until its explicit enable checkbox is checked.
Renderer/geometry controls and PNG exports stay with
each example. `charts.css` is scoped to `.chart-examples` (plus a uniquely named
Vega tooltip); it must not change the original fixture's styles or planted cases.

The `charts.*` ids name sections, headings, controls and chart surfaces. Raster
mode additionally declares an image-region target; C's plot root now remains
present across SVG and PNG modes, preserving old plot references. Chart code
imports only independent artifact contracts (`anno`, `chart`, `chart-adapters`),
never the annotation runtime. All examples use the checklist in INSTRUCTIONS.md
§5. `chart-bindings.tsx` supplies React lifecycle wiring, not a second selection
engine. Shapes/paths and live pixel geometry never enter the event log.

`public/chart-composition.png` is committed synthetic fixture data: a ReportLab
4.4.4 pie, rendered via PDF/PyMuPDF 1.26.4, with the same 18 values and total as
`src/fixture/charts/raster.json`. No runtime image generation is needed.
The chart dependencies are fixture-only; `build:library` does not include them.

Run `node scripts/check-chart-examples.mjs` against the development harness,
alongside the original fixture/annotation suites. It never seeds production
comments. Its normal pass verifies that WebGL stays off. `RUN_WEBGL=1` opts
into the spatial checks in a separately provisioned capable browser; it does not
add GPU flags or enable software rendering. Optional `BASELINE_JSON` points to a pre-change DOM/style/geometry
snapshot for verifying that the original fixture is visually unchanged.

### Planted hit-test cases

The document is realistic, but the hard cases are deliberately placed where
they'd naturally occur. ★ = expected to actually bite.

| # | Case | Where |
|---|---|---|
| 1 ★ | Zero-gap fill — child exactly fills parent | `wireframe.msg.m2` / `.body` |
| 2 | Boundary-hugging siblings, shared edge | reaction buttons |
| 3 ★ | Overflow badge — child visually outside parent | thumbs-up count |
| 4 | Target smaller than the pin | 16px `⋯` in header |
| 5 ★ | Inline block target inside `mode="text"` prose | summary paragraph |
| 6 ★ | Nested scroll container | thread list |
| 7 | Sticky header | document header |
| 8 | Conditional mount | `⋯` menu items |
| 9 ★ | Keyed list reorder | sort toggle |
| 10 | Dense grid of small adjacent targets | decisions table |

Rules tagged `CASE n` in `styles.css` are load-bearing; the comments say why.
Case 1: `.msg` has no padding and no border (the hairline is `box-shadow`), so
the body's rect is identical to the card's and nearest-ancestor hit-testing can
never land on the card — which is what forces the **widen** control to exist. It
isn't only a planted hazard: a table row is fully tiled by its cells, so
`decisions.d-2` is unreachable by click for the same reason.

### Positioning: one container per positioning context

The rule the overlay follows (`annotations/layout.ts`), arrived at by getting it wrong twice:

- **`document`** — absolute, document coordinates, for normal-flow targets. Page
  scroll moves the container and every child at once: O(1).
- **`viewport`** — fixed, viewport coordinates, for `sticky`/`fixed` targets and
  anything inside an inner scroll container. Recomputed on scroll; few targets qualify.
- **clipping** — intersected against every enclosing scroll root. Outlines are
  clipped; pins hide when their anchor point leaves the window.

A single document-coordinate container is not sufficient: outlines once drifted
376px from the sticky header on scroll. `check-fixture.mjs` asserts alignment
after both page and inner-container scroll.

### Demo-content exercises — revert before committing

When testing live commenting by requesting changes to the demo document, revert
those edits before committing. Keep real library fixes and regression tests.
Never reset a live review server's `runtime-state/` while reverting demo content.

## Derived files — regenerate, don't commit

| Path | Regenerate with |
|---|---|
| `fixture/node_modules/` | `npm ci` |
| `fixture/lib/`, `fixture/*.tgz` | `npm run build:library` |
| `fixture/dist/` | `npm run build` |
| `fixture/*.png`, `fixture/test-output/` | the check suites |
| `fixture/runtime-state/`, `fixture/*.sock` | the review server / dev harness (project data, not source) |
| `*.tsbuildinfo` | `tsc` |

The image assets under `fixture/public/` are real fixture data:
`reference-screenshot.svg` backs planted case 5; `image-annotation-example.{svg,png}`
back the raster region example (the PNG is committed so no image generation is
needed to build).

`fixture/THIRD_PARTY_NOTICES.md` covers runtime dependencies and, in a separate
section, chart-fixture dependencies. The chart libraries are not bundled into
the annotation package; `html-to-image` is a bundled runtime dependency. Preserve
the original licence texts when adding, removing or upgrading dependencies.

## Versioning and releases

Use `fixture/package.json` as the single public version source. The current
release candidate is 6.0.0, following the historical v1–v5 milestones. Use SemVer from here:
patch for fixes, minor for compatible additions, major for breaking integration
changes. Release tags are `v<package-version>`; branch names describe development
work and are not another release-number sequence. Do not bump the version for
every local experiment or create changelog entries for unpublished build iterations.

The host/server `protocol` field and persisted schema discriminators are internal
compatibility mechanisms. They do not identify product releases. Keep matching
host/server code together; change those counters only when the corresponding
contract changes, not automatically on a package-version bump. See
`fixture/src/App.tsx`, `fixture/server.mjs` and `fixture/server/chart-refs.mjs`.

### Release preparation

For a package release, first restore temporary fixture data and review
`git diff` for test-only changes. Bump the package version and give the changelog
one entry describing the final behavior; record wire-protocol compatibility
separately from the package version. Build the fixture and library, run the
server and affected browser suites on isolated SQLite state, and install the
resulting tarball in a separate consumer app. Inspect `npm pack`'s file list:
it must exclude runtime databases, credentials, test output and fixture code.
The source repository supplies the server/CLI; the tarball supplies the browser
library, independent chart contracts, declarations, CSS and integration guide.

Local platform simulations verify our protocol handling but do not replace a
published PromptQL smoke test: grant viewer consent, post a bot-directed chart
comment, read its reference and PNG through the bot CLI, reply, and verify the
reply reaches another viewer. The app also needs the durable bot instructions
from `INSTRUCTIONS.md` §7. Tag/publish the reviewed commit and its built tarball.

The server reads `BUILD_ID` and every other variable once at start, and tabs
learn about a new build only from the id the server returns. After `npm run
build`, restart the service (see `INSTRUCTIONS.md` §6); open tabs show the red
⟳ within a poll. `runtime-state/` is untouched by a restart. Bump
`fixture/package.json`'s version when the packaged library changes and note it
in `CHANGELOG.md`.
