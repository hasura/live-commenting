# Annotation fixture

The artifact the annotation layer is developed and tested against: a product
spec that describes a commenting feature and embeds a live HTML wireframe of it.

```sh
npm install
npm run dev                          # http://localhost:5180

# both suites need the dev server running; they run headless
node scripts/check-fixture.mjs       # artifact contract + planted cases
node scripts/check-annotations.mjs   # the annotation layer, end to end
```

The suites drive a real Chromium-family browser through `playwright-core`, which
downloads nothing — so one must already be installed. `scripts/browser.mjs`
looks in the usual places; set `CHROME_PATH` if yours is elsewhere, and
`HEADED=1` to watch a run. See the root `README.md` for details.

Press `C` (or use the bottom toolbar) to enter comment mode, then click an
element. `Esc` discards a draft; a second `Esc` leaves the mode.

## Why this shape

A spec doc gives real prose (text mode). An embedded wireframe gives a densely
nested interactive UI (block mode) with a legitimate reason to sit *inside* that
prose. So text and element mode collide on one page — which is where the
interesting bugs are. A dashboard would have no prose; a bare test grid would
have no realism.

86 targets: 63 `block`, 22 `text`, 1 `region`.

## The contract

`src/anno.ts` is the whole artifact-side API, and it has **zero imports** by
design. The artifact emits `data-anno-*` attributes and nothing else; the
annotation layer mounts separately and reads them off the DOM. That boundary
means a generated artifact never takes a dependency on the commenting runtime —
otherwise every artifact ever shipped is version-locked to the library.

```tsx
<button {...anno('wireframe.composer.send', 'Send comment', { semantic: { kind: 'action' } })}>
```

| attribute | required | notes |
|---|---|---|
| `data-anno-id` | yes | unique within the artifact — that's the only constraint |
| `data-anno-label` | yes | descriptive, non-unique, read by humans and models |
| `data-anno-mode` | no | `block` is implicit and must not be emitted |
| `data-anno-semantic` | no | structured extras (`row`, `column`, `value`, …) |

`anno()` spreads props rather than wrapping in a component. A wrapper element
would add DOM the artifact doesn't need, and would make *every* target a
zero-gap nest (a wrapper always exactly contains its child) — manufacturing the
hardest hit-test case everywhere instead of only where it's real.

**Ids need only be unique within the artifact.** `id125` would be valid. A
dotted path is one convention (`wireframe.composer.send`); the decisions table
instead composes row identity with column name (`decisions.d-2.call`). The layer
never parses ids. Semantic ids are worth *advising* — a generator regenerating
from scratch may re-derive them and get anchor continuity for free — but they are
a bonus, not a requirement.

Ids must derive from *data identity*, never list position. See case 9.

## Layout

```
src/
  anno.ts                    the contract — zero imports, don't add any
  App.tsx                    #artifact-root | annotation layer | dev boundary
  fixture/                   THE ARTIFACT
    SpecPage.tsx             document shell, prose, header (cases 4, 5, 7, 8)
    DecisionTable.tsx        dense grid (case 10)
    Wireframe.tsx            the torture zone (cases 1, 2, 3, 6, 9)
  annotations/               THE LAYER — kind: 'anno_id'
    index.ts                 public surface
    types.ts                 AnnotationDoc (persisted) vs Target/Pin (ephemeral)
    target.ts                reading data-anno-*, hit-testing, widen chain
    layout.ts                positioning contexts and clipping — the hard part
    cluster.ts               pins derived from threads
    store.ts                 immutable doc helpers + useAnnotations
    Annotations.tsx          root, toolbar, orchestration
    Overlay.tsx              containers, outlines, pins
    Thread.tsx               read / reply / resolve / reopen
    Composer.tsx             the pluggable seam; ships a single text field
  dev/                       DEV ONLY
    plantedCases.ts          registry of the 10 planted cases
    DevOverlay.tsx           inspector — NOT the annotation layer
  styles.css                 rules tagged CASE n are load-bearing
scripts/
  check-fixture.mjs          artifact contract + planted-case geometry
  check-annotations.mjs      the annotation layer, end to end
```

`annotations/` has no dependency on `fixture/` and can be lifted into a package
unchanged. It lives here for now because the fixture is its only consumer.

## Planted hit-test cases

The document is realistic, but the hard cases are deliberately placed where
they'd naturally occur. Open the **fixture inspector** (bottom right) and hover
a case to outline its elements. ★ = expected to actually bite.

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

`scripts/check-fixture.mjs` verifies each case still holds geometrically — so if
someone "tidies" the CSS and a case stops being hard, it fails loudly rather
than silently making the test suite easier. Rules tagged `CASE n` in
`styles.css` are load-bearing; the comments say why.

Case 1 is worth understanding: `.msg` has no padding *and no border* (the
hairline is `box-shadow`, which doesn't affect the layout box), so the body's
rect is exactly identical to the card's and nearest-ancestor hit-testing can
never land on the card. That's what forces the **widen** control to exist — and
it isn't only a planted hazard: a table row is fully tiled by its cells, so
`decisions.d-2` is unreachable by click for exactly the same reason.

## Positioning: one container per positioning context

The rule the overlay follows, arrived at by getting it wrong twice
(`annotations/layout.ts`):

- **`document`** — absolute, document coordinates. Normal-flow targets. Page
  scroll moves the container and every child at once, so this is O(1). Figma hit
  15fps at 30 pins by doing it per-pin instead.
- **`viewport`** — fixed, viewport coordinates. `sticky`/`fixed` targets, and
  anything inside an inner scroll container, whose screen position moves
  independently of page scroll. Recomputed on scroll, but few targets qualify.
- **clipping** — intersected against every enclosing scroll root. Outlines are
  clipped; pins hide when their anchor point leaves the window.

A single document-coordinate container is *not* sufficient, and the inspector
originally shipped with that bug: outlines drifted 376px away from the sticky
header on scroll. `check-fixture.mjs` now asserts alignment after both page and
inner-container scroll — and asserts the comparison was non-empty, since a
vacuous pass is what let it through the first time.

## The dev inspector is not the annotation layer

`DevOverlay.tsx` shows what the artifact declares, and has a second tab showing
the live annotation document. That tab is the quickest way to confirm the
round-trip contract by eye: nothing in it should be a pixel measurement, a
cluster, or a visibility flag — only refs, snapshots and comment bodies.

It shares `useLayouts` with the annotation layer rather than reimplementing
positioning, which is why both are correct for the same reason.
