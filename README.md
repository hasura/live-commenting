# Collaborative HTML Annotation Library

A commenting layer for generated HTML artefacts. Reviewers leave threads
anchored to parts of a document — a card, a table cell, a button in an embedded
wireframe — and the comments survive regeneration of the artefact because they
anchor to declared identity, not to DOM position.

The artefact and the annotation layer are kept strictly apart:

- The **artefact** emits `data-anno-*` attributes (id, label, optional mode and
  semantic payload) and nothing else. `fixture/src/anno.ts` is the whole
  artefact-side contract and has zero imports by design.
- The **annotation layer** (`fixture/src/annotations/`) mounts separately, reads
  those attributes off the DOM, and renders pins, outlines and threads. It is
  controlled: the host owns the annotation document and persists it however it
  likes.

Implemented today: element-anchored comments (`Ref.kind === 'anno_id'`). Text
ranges and image regions are present in the schema but not implemented.

## Documentation

| File | Read it for |
|---|---|
| `INSTRUCTIONS.md` | Making an artefact commentable and mounting the layer — attributes, id scheme, document schema, custom composers, interaction contract |
| `fixture/README.md` | The reference fixture: why it is shaped the way it is, the planted hit-test cases, the overlay positioning rule |
| `prior/README.md` | Prior art the design drew on, with licences — optional read-only clones |

## Repository layout

```
INSTRUCTIONS.md                     how to use the library
fixture/                            Vite + React 19 + TypeScript
  src/anno.ts                       artefact-side contract (zero imports)
  src/annotations/                  the annotation layer — no dependency on fixture/, liftable as-is
  src/fixture/                      the reference artefact the layer is developed against
  src/dev/                          dev inspector (not part of the layer)
  src/App.tsx                       host: #artefact-root | annotation layer | inspector
  scripts/check-fixture.mjs         artefact contract + planted-case geometry (20 assertions)
  scripts/check-annotations.mjs     the annotation layer, end to end (46 assertions)
  scripts/browser.mjs               browser resolution shared by both suites
  public/reference-screenshot.svg   the fixture's only image asset
prior/clone.sh, prior/README.md     how to fetch the prior-art references
```

`fixture/annotations/` has no dependency on `fixture/fixture/` and can be lifted
into a package unchanged. It lives inside the fixture because the fixture is
currently its only consumer.

## Requirements

- Node 20.19+ or 22.12+ (Vite 7's minimum). Tested on Node 24.
- For the check suites: a Chromium-family browser already installed (Chrome or
  Chromium from your distro's packages is fine). `playwright-core` downloads
  nothing.

## Build

```sh
cd fixture
npm install
```

Some npm versions block postinstall scripts by default. `esbuild` needs one, or
Vite won't start. `package.json` already whitelists it under `allowScripts`; if
your npm ignores that field it will print a warning telling you how to approve
it (on npm 11 that is `npm approve-scripts esbuild`).

```sh
npm run typecheck        # tsc -b --noEmit
npm run build            # tsc -b && vite build → fixture/dist/
npm run preview          # serve the production build locally
```

## Run the fixture

```sh
cd fixture
npm run dev              # http://localhost:5180
```

`vite.config.ts` sets `port: 5180` with `strictPort: false`, so Vite silently
picks the next free port if 5180 is taken — read the actual URL off the startup
banner. To pin it: `npx vite --port 5199 --strictPort`.

Press `C` or click **Comment** in the bottom toolbar, then click an element.
`Enter` saves, `Shift+Enter` newlines, `Esc` discards a draft, a second `Esc`
leaves comment mode. The **fixture inspector** (bottom right) shows what the
artefact declares and, on its **document** tab, the live annotation JSON.

## Test

Both suites drive a real Chromium-family browser through `playwright-core`. They
run **headless**, so no display server is required, and they need the **dev
server already running**.

```sh
cd fixture
npm run dev &                        # or in another terminal

node scripts/check-fixture.mjs       # 20 assertions
node scripts/check-annotations.mjs   # 46 assertions
```

Both take an optional URL argument for a non-default port:

```sh
node scripts/check-fixture.mjs http://localhost:5199/
```

Expected tail of each run:

```
console/network errors: none

fixture check passed
```

A non-zero exit means a real failure. Both scripts print every assertion as they
go, so the first `FAIL` line is the lead.

`check-fixture.mjs` verifies that every planted hit-test case still holds
geometrically, so if a CSS "tidy-up" makes a case stop being hard, it fails
loudly rather than silently making the suite easier. It also guards overlay
positioning: it compares overlay boxes against their elements after page scroll
and after inner-container scroll, and asserts that comparison was non-empty.
Keep that assertion — a vacuous pass is how a positioning drift bug can slip
through.

### Browser resolution

`scripts/browser.mjs` finds a browser without hardcoding a path, in order:

1. `$CHROME_PATH`, if set
2. the usual install locations (`/usr/bin/google-chrome{,-stable}`,
   `/usr/bin/chromium{,-browser}`, `/snap/bin/chromium`, …)
3. Playwright's `channel: 'chrome'`, which does its own system lookup

If none work it fails with the list it tried.

| Env var | Effect |
|---|---|
| `CHROME_PATH=/path/to/chrome` | point it at a browser it can't find |
| `HEADED=1` | run visibly instead of headless — needs a working display |

## Derived files — regenerate, don't commit

Nothing below is tracked; all of it regenerates.

| Path | Regenerate with |
|---|---|
| `fixture/node_modules/` | `npm install` |
| `fixture/dist/` | `npm run build` |
| `fixture/fixture.png` | `node scripts/check-fixture.mjs` (full-page screenshot) |
| `fixture/annotations.png` | `node scripts/check-annotations.mjs` (viewport screenshot) |
| `*.tsbuildinfo` | `tsc` |
| `prior/<clones>/` | `./prior/clone.sh` |

The two PNGs are screenshots the check suites write on every run so a human can
eyeball a result. Nothing reads them. **The fixture's only image asset is
`fixture/public/reference-screenshot.svg`** — it is committed and not
regenerable; if it goes missing, planted case 5's figure loses its image and the
`mode="region"` target has nothing to point at.

## Runtime state in the fixture

The library never persists anything; the host does. In the fixture the host is
`fixture/src/App.tsx`, which uses `localStorage` purely as a stand-in for a real
sidecar.

| | |
|---|---|
| key | `annotation-fixture-doc` |
| artefact version | `spec-v0.3` (the `ARTEFACT_VERSION` constant in `App.tsx`) |
| empty value | `{"version":1,"artefactVersion":"spec-v0.3","threads":[]}` |

There is no seed data and the fixture does not need any: it boots to an empty
document and you create comments by hand. Both check suites clear the key and
start from empty, so a run never depends on prior state.

**Reset:** the *clear all* button on the inspector's **document** tab, or

```js
localStorage.removeItem('annotation-fixture-doc'); location.reload();
```

**Seed** a populated document (paste into the console, then reload). This is
also the shape to hand-write test fixtures in:

```js
localStorage.setItem('annotation-fixture-doc', JSON.stringify({
  version: 1,
  artefactVersion: 'spec-v0.3',
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

A ref whose `id` does not exist in the artefact is a useful thing to seed
deliberately: it exercises the unanchored tray and shows that the snapshotted
`label`/`semantic` keep the comment readable with no element to point at.
`check-annotations.mjs` does exactly this with a `doc.header.menu.export` ref.

Full schema in `INSTRUCTIONS.md` §7.

## Prior art

`prior/README.md` lists the reference implementations the design was compared
against, with licences. The clones are not part of this repository; fetch them
with `./prior/clone.sh` (idempotent, `--depth 1`, ~110 MB, needs network) only if
you want to read them.