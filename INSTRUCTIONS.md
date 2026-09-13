# Using the annotation layer

For bots generating an artifact that should be commentable, and wiring the
layer onto it. Reference implementation: `fixture/`.

Implemented: element references, block-scoped text selection, fractional image regions,
sent review rounds, semantic flattening, and explicit revision helpers. The host still
owns persistence. See the root `README.md` for building, testing, the review app and its
environment variables, and packaging.

---

## 1. The two halves, and why they stay apart

```
#artifact-root          your generated markup. Emits data-anno-* and nothing else.
<Annotations>           mounts as a SIBLING, is handed the root element.
```

The artifact must never import the annotation runtime. `fixture/src/anno.ts` has
zero imports for exactly this reason: an artifact that depends on the commenting
library is version-locked to it forever, and you will ship many artifacts.

Copy `anno.ts` into the artifact, or inline the four attributes by hand. Both are
fine. Importing the library from artifact code is not.

---

## 2. Data attributes

| Attribute | Required | Rule |
|---|---|---|
| `data-anno-id` | **yes** | Unique within the artifact. That is the only hard constraint. |
| `data-anno-label` | **yes** | Human- and LLM-readable name. No uniqueness or length limit. |
| `data-anno-mode` | no | `text` or `region`. **`block` is the default and must NOT be emitted.** |
| `data-anno-semantic` | no | JSON object. Structured extras for machines. |

Plus one attribute for *your own* UI, if the artifact has chrome that should
never be commentable:

| `data-anno-ignore` | Any element with this, or inside one, is invisible to hit-testing. |

### Emitting them

```tsx
import { anno, annoText, annoRegion } from './anno';

<button {...anno('composer.send', 'Send comment', { semantic: { kind: 'action' } })}>
  Send
</button>

<p {...annoText('spec.summary', 'Summary prose', { kind: 'prose' })}>…</p>

<figure {...annoRegion('fig.1', 'Prior art screenshot', { kind: 'figure' })}>…</figure>
```

`anno()` **spreads props; it is not a wrapper component.** Do not build an
`<Annotatable>` wrapper. A wrapper adds a DOM node the artifact doesn't need,
and — because a wrapper always exactly contains its child — it makes every
target a zero-gap nest, which is the single hardest case for hit-testing. Create
that situation only where the real layout does.

---

## 3. Choosing `data-anno-id`

**Invariant: unique within the artifact, and stable across regenerations.**
Nothing else is required. `id125` is a valid id — the library never parses ids.

### Stability is the property that matters

A comment survives a revision if and only if its id reappears. So:

- **Derive ids from data identity, never from list position.** `msg.${m.id}` is
  correct; `msg.${index}` silently relocates every comment when the list is
  sorted or filtered. This is planted case 9 in the fixture.
- When regenerating an artifact, **preserve the id of any block you did not
  substantially change.** When you rewrite a block in response to a comment,
  emit a new id *plus* `data-anno-supersedes="<old-id>"`. Never reuse an id for
  different content.

That protocol is verifiable — diff the id sets between two versions and assert
the invariants — which is why it replaces fuzzy text matching entirely.

### Suggested scheme

Prefer a **semantic hierarchical dotted path**: `wireframe.composer.send`,
`spec.summary.token`. Two reasons, neither mandatory:

1. It reads well in debugging output and in the inspector.
2. If you ever regenerate an artifact *without* the previous version to hand, a
   self-describing id has a real chance of being re-derived identically, so
   comments survive for free.

Compose from whatever identity the data already has. For tabular content, row
identity plus column name is the natural scheme and needs no invention:

```
decisions.d-2.call        // row d-2, column "call"
sheet.Q3.EMEA.margin
```

Don't strain for elegance. Unique and stable beats pretty.

---

## 4. What to mark annotatable

**Granularity is your decision, not the library's.** Nothing is annotatable
unless you say so — that inversion is the whole design. A node with no
`data-anno-id` is transparent: hit-testing walks past it to the nearest declared
ancestor.

So layout wrappers, spacing divs and styling spans should carry nothing at all.
They then disappear from commenting automatically, with no blacklist to maintain.

Rule of thumb: **mark the units a person would name in a sentence.** If you
can't say "the X" out loud, it shouldn't be a target. "The Send button", "the
EMEA margin cell", "Ada's comment" — yes. "The flex row that holds the buttons"
— no.

Aim for tens of targets per screen, not hundreds. The fixture has 86 across a
full page and that is on the busy side.

Two consequences worth knowing:

- **A container fully tiled by its children is unreachable by click.** A table
  row is covered entirely by its cells, so nearest-ancestor resolution can never
  land on the row. It is still worth marking (`this whole decision is wrong` is a
  real comment) — the UI offers a one-step **widen** control for exactly this.
  Just don't expect a direct click to reach it.
- **Nesting is fine and normal.** Mark the card *and* the cell *and* the button
  if all three are things a reviewer might mean.

---

## 5. Labels

`data-anno-label` is read by humans (hover chip, `commenting on: …`, the
unanchored tray) and by models (prompt serialisation). It is snapshotted onto
the comment at creation, so it keeps working after the element is deleted.

- Descriptive beats terse. There is no length limit and no uniqueness
  requirement — "Reply" appearing three times is fine.
- Name the element **on its own terms**, not its full path. Qualification is
  composed from the ancestor chain when needed; don't pre-bake it.
- Don't put identity in it. That's the id's job.

`data-anno-semantic` is for anything a model would want that it could not
recompute from the DOM — domain coordinates, values, authorship:

```tsx
{...anno(`decisions.${row.id}.call`, `${row.question} → Call`, {
  semantic: { kind: 'cell', row: row.question, column: 'Call', value: row.call },
})}
```

This is what turns a comment from *"character offset 4182"* into *"row EMEA,
column Margin, value 12%"* in a prompt. It is the point of the exercise.

---

## 6. Mounting the layer

`Annotations` is **controlled**. The host owns the document; the component reads
it and returns a new one via `onChange`. It never keeps its own copy — which is
what makes the artifact/annotation round trip safe by construction rather than by
discipline.

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Annotations, emptyDoc, type AnnotationDoc } from './annotations';

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [doc, setDoc] = useState<AnnotationDoc>(() => load() ?? emptyDoc('spec-v0.3'));

  useEffect(() => setRoot(rootRef.current), []);

  const [insets, setInsets] = useState({ top: 45, bottom: 0 });

  const onChange = useCallback((next: AnnotationDoc) => {
    setDoc(next);
    save(next);                     // yours: file, API, Yjs, localStorage…
  }, []);

  return (
    <div className="review-shell" style={{
      '--review-top': `${insets.top}px`,
      '--review-bottom': `${insets.bottom}px`,
    } as React.CSSProperties}>
      <div id="artifact-root" ref={rootRef}>
        <YourArtifact />
      </div>
      <Annotations
        root={root}
        annotations={doc}
        onChange={onChange}
        author={{ id: 'user-1', name: 'Ada Okonjo' }}
        onLayoutChange={setInsets}
      />
    </div>
  );
}
```

`root` is `null` on the first render — that's expected and handled.

Reserve the chrome's measured height in the **host shell**, not the generated
content. This is required for the fixed header not to cover the first targets:

```css
.review-shell {
  padding-top: var(--review-top, 45px);
  padding-bottom: var(--review-bottom, 0px);
}
/* Host-defined sticky headers inside the artifact: */
.artifact-sticky-header { top: var(--review-top, 45px); }
```

Use a stable callback such as `setInsets`. `onLayoutChange` reports CSS pixels
including safe-area padding, and bottom is zero when no compact surface is open.
Do not apply the inset twice. With a fixed-height scroll root, reserve space on
that scroll root instead and set its scroll padding. Do not put the annotation
portal inside a transformed/scaled slide or a clipping container.


### Props

| Prop | Required | Notes |
|---|---|---|
| `root` | yes | The artifact element. Targets outside it are ignored. |
| `annotations` | yes | The document. |
| `onChange` | yes | Receives a **new** document. Persist it here. |
| `author` | yes | `{ id, name }`, stamped onto comments. |
| `composer` | no | Swap the composer — see §8. Defaults to `TextComposer`. |
| `portalTo` | no | Where toolbar and popovers mount. Defaults to `document.body`. |
| `toolbarActions` | no | Legacy custom action slot, used only when `review` is absent. Keep labels compact and guard unposted editors in the host. |
| `review` | no | Typed host-owned send state/action: `ReviewStatus`. Prefer this over custom sending controls. |
| `onLayoutChange` | no | Reports `{ top, bottom }`; wire it to the host layout when using the fixed review shell. |
| `onDraftStateChange` | no | True while a new/reply editor exists, even empty or minimized. Guard sending/reloads against this state. |
| `readOnly` | no | Prevents document edits; viewing remains available. |

If you'd rather not hold state, `useAnnotations(initial?)` returns
`{ doc, setDoc, reset }` — sugar over the controlled path, same as
`defaultValue` on an input.

---

## 7. The document

Initial state is `emptyDoc(artifactVersion?)`:

```json
{ "version": 1, "artifactVersion": "spec-v0.3", "threads": [] }
```

Full shape after a comment and a reply:

```json
{
  "version": 1,
  "artifactVersion": "spec-v0.3",
  "threads": [
    {
      "id": "0b7e…",
      "refs": [
        {
          "kind": "anno_id",
          "id": "wireframe.panel.sort",
          "label": "Sort order toggle",
          "semantic": { "kind": "action", "state": "newest-first" }
        }
      ],
      "pin": { "xPct": 0.62, "yPct": 0.41 },
      "status": "open",
      "comments": [
        {
          "id": "9c11…",
          "author": { "id": "user-1", "name": "Ada Okonjo" },
          "createdAt": "2026-09-07T11:04:22.318Z",
          "body": [{ "kind": "text", "value": "Should say Sort, not Newest." }]
        },
        {
          "id": "4f02…",
          "author": { "id": "user-2", "name": "Ravi Menon" },
          "createdAt": "2026-09-07T11:09:50.002Z",
          "body": [{ "kind": "text", "value": "Agreed." }]
        }
      ]
    }
  ]
}
```

Notes on the shape:

- `refs` is **plural** and `Ref` is a union, so a text selection spanning
  several blocks becomes several refs rather than silently widening to their
  common ancestor. `anno_id`, `text`, and `region` all resolve by target ID.
- `label` and `semantic` on the ref are **snapshots taken at creation**. That is
  what keeps a comment readable after its element is gone. Without them an
  unresolvable ref is a dead id.
- `pin` is cosmetic — fractions of the target's box, so it survives responsive
  reflow. Losing it misplaces a pin; losing the ref loses the comment.
- `comments[0]` is the root; the rest are replies.
- `body` is an array of a discriminated union, so a different composer stores
  different content without a schema change. Only `kind: 'text'` is produced
  today; `kind: 'choice'` is reserved and unused.
- `status` is `open | resolved`.

### Nothing ephemeral belongs in here

The document is pure serialisable data that round-trips through regeneration
untouched. Pixel measurements, cluster membership, visibility flags, which
popover is open, whether comments are shown — all of that is per-user or
per-frame state and lives outside.

The tell: *"are comments visible"* is a view setting. If it ever appears in the
document, the separation has leaked. The inspector's `document` tab exists partly
so you can check this by eye.

### Persistence

The library does not persist anything. A sidecar beside the artifact is the
recommended default — `artifact.annotations.json`, or an inline
`<script type="application/json">` for a single-file artifact. No backend
required, the artifact stays self-contained and shareable, it diffs cleanly, and
the LLM round-trip payload is one thing rather than a join.

The development fixture uses `localStorage` as a stand-in. The production review app adds visitor-authenticated shared save/reload; this is host code, not library persistence.

---

## 8. Custom composers

The composer is the intended extension seam. Anything that produces a `Body[]`
qualifies — radio set, emoji picker, rating, small form. Because `Body` is a
union in the schema, swapping it changes what gets stored without touching the
schema or any of the pin/anchoring machinery.

```tsx
function VerdictComposer({ onSubmit, onCancel }: ComposerProps) {
  return (
    <div>
      {['approve', 'reject'].map((v) => (
        <button key={v} onClick={() => onSubmit([{ kind: 'choice', value: v }])}>
          {v}
        </button>
      ))}
      <button onClick={onCancel}>Cancel</button>
    </div>
  );
}

<Annotations … composer={VerdictComposer} />
```

The composer is used for both new threads and replies, so handle `initial`,
`placeholder` and `submitLabel` if you want those to differ. Honor `disabled`.
Call optional `onDismiss` for incidental Escape/minimize, reserving `onCancel`
for an explicit discard. An optional `onDraftChange(Body[])` can notify custom
hosts of text changes. Editors are kept mounted when minimized, so local React
state survives even if they do not implement this callback. Only one reply
editor is allowed per open group at a time; the shell blocks typed sending for
the entire editing session, not just nonempty text.

---

## 9. Interaction contract (what users get)

Worth knowing so you don't rebuild it:

- The blue header toggles comment **mode** — a mode, not a one-shot
  action, because a review pass is many comments.
- In comment mode a click means *"comment on this"*, never *"activate this"*.
  Clicks are suppressed in the capture phase, so your buttons and links are safe.
- Hover outlines the **resolved** target and names it, so the user sees what they
  are about to comment on before clicking.
- **`Enter`** saves, **`Shift+Enter`** newlines.
- Outside tap, **`Esc`**, or the minimize button hides the panel without
  unmounting its editor. **Resume draft** restores it. **Cancel** explicitly
  discards. Draft text survives viewport/mode changes, **not page reload** or
  host unmount; use host persistence if that is required.
- Entering comment mode forces pins visible (so you reply instead of
  duplicating); exiting leaves them visible until the user hides them.
- Compact artifact viewports (width ≤700px **or** height ≤480px) use a footer
  discussion/composer. Wider, taller viewports retain an anchored popover.
  Size is the artifact viewport, not the outer browser window. A footer can
  expand, scroll its contents and minimize; it is not a modal/focus trap.
- The header exposes comments, mode and the host's sending state; resolved
  and unanchored details live under **More comment options**.
- The library never sends a review or infers delivery from a local comment.
- Reading and replying work **outside** comment mode.
- Threads whose refs don't resolve appear in a page-level tray, still readable
  from their snapshots.

---

## 10. Checklist

Generating an artifact:

- [ ] Every target has a unique `data-anno-id` derived from data identity, not index
- [ ] Every target has a descriptive `data-anno-label`
- [ ] `data-anno-mode` omitted for block targets
- [ ] `data-anno-semantic` carries anything a model couldn't recompute from the DOM
- [ ] Layout/styling wrappers carry no attributes
- [ ] Own UI chrome marked `data-anno-ignore`
- [ ] Artifact code imports nothing from `annotations/`

Regenerating one:

- [ ] Ids preserved for blocks not substantially changed
- [ ] `data-anno-supersedes="<old-id>"` on blocks rewritten in response to a comment
- [ ] No id reused for different content
- [ ] Id sets diffed against the previous version to confirm the above

## 11. Text, regions, rounds, and revision APIs

### Selection shapes

```ts
{ kind: 'text', id: 'paragraph-42', start: 4, end: 19, quote: 'selected phrase', label: 'Summary' }
{ kind: 'region', id: 'figure-7', xPct: 0.2, yPct: 0.1, wPct: 0.4, hPct: 0.3, label: 'Architecture' }
```

Text offsets are UTF-16 offsets in the nearest declared block's `textContent`.
The exact quote must still match. Cross-block selection creates separate refs;
atomic inline targets are included whole. Region values are fractions, not pixels.

Click/tap targets the whole nearest declared element. Mouse drag selects a text
range or region. `Alt+Enter` annotates a native text selection. Mobile tap and
region drag are tested; native mobile text-selection UX needs further polish.

### Sent rounds

`closeRound(doc, artifactHTML?, saveId?)` snapshots pending discussions and marks
them with `closedRoundId`. Store helpers refuse edits to closed discussions.
The `rounds` array is immutable review history; save/reload it with the document.
The host must enforce immutability too—UI state alone is not authorization.

`flattenAnnotations(doc)` produces prompt-ready text from ref labels, semantics,
quotes, regions and comments. It needs no DOM. For Node callers, import it from
`collaborative-html-annotation/review`.

### Generator continuity

```tsx
// Rewritten content gets a fresh ID and an explicit predecessor:
<p {...anno('summary-v2', 'Summary', {
  mode: 'text', supersedes: 'summary-v1',
  semantic: { kind: 'prose' }
})}>Rewritten summary</p>
```

```ts
const previous = readManifest(oldRoot);
const next = readManifest(newRoot);
const updated = applyRevision(doc, previous, next, 'artifact-v2');
// Throws before changing doc if continuity fails.
```

The default manifest fingerprints own text, semantic attributes, mode and common
content attributes; nested declared targets are treated independently. For SVG,
canvas, external data or behavior-sensitive changes, supply your own domain-aware
fingerprints. This is declared continuity validation, not universal semantic proof.

Element refs may follow an unambiguous declared replacement and become `addressed`.
Addressed does not mean resolved. Text and region refs on rewritten targets become
unanchored, with original snapshots preserved. Sent-round archives stay unchanged.

### Packaged consumption

```ts
import { Annotations, emptyDoc } from 'collaborative-html-annotation';
import 'collaborative-html-annotation/annotations.css';
// Generated content imports only this independent helper:
import { anno } from 'collaborative-html-annotation/anno';
```

Peer dependencies: React 19, React DOM 19, Floating UI React 0.27.
A ready-made non-text composer and margin rail are optional future UI work.

## 12. Responsive review integration

### Delivery belongs to the host

```tsx
<Annotations
  root={root}
  annotations={doc}
  onChange={persistLocally}
  author={visitor}
  onLayoutChange={setInsets}
  onDraftStateChange={setHasEditor}
  review={{
    state: deliveryState, // idle | unsent | sending | sent | error | uncertain
    pendingCount: pending,
    disabled: !authorized,
    message: deliveryDetail,
    onSend: sendWithStableIdempotencyKey,
  }}
/>
```

`idle`/`sent`/`sending` disable the action. `unsent` exposes Send, `error` Retry
send, and `uncertain` Check save. Only publish `sent` after the host confirms
delivery; an uncertain response must retry/check the same save ID, not create
a new send. The library also disables typed sending while an editor exists.
Legacy `toolbarActions` hosts must use `onDraftStateChange` to implement the
equivalent guard. A DOM-only textarea query misses custom and minimized state.

The existing host remains responsible for visitor authorization, persistence,
revision conflicts, delivery errors and immutable sent rounds. Do not persist
viewport geometry or minimized/expanded state inside `AnnotationDoc`. No
annotation-document schema or backend change is needed for the responsive shell.

### Recipes for generated artifacts

- **Spec:** readable wrapping prose, an explicit wide-table scroll container,
  stable paragraph anchors, and a host-reserved top/bottom inset. Offset any
  sticky document header by the measured top inset.
- **UI mockup:** keep real button actions functioning outside comment mode,
  label stable review targets, test inner scrolling and final form controls.
  Fixed or nested scrolling hosts must reserve the insets in their own layout.
- **Slide deck:** keep the annotation portal a sibling outside the transformed
  slide canvas. Preserve stable per-slide anchor identities. The responsive
  shell does not solve hidden-slide navigation: unmounted targets still enter
  the unanchored tray until their slide returns. A navigation/manifest contract
  is separate follow-up work, not an API provided by this version.

### Test boundaries

Use `fixture/LAB.md`: the same three fixtures run against a frozen baseline and
a candidate, with separate browser-local documents and simulated sends.
Validate real iOS Safari and Android Chrome (software keyboard, selection
handles, browser bars, orientation, safe areas) before release. Chromium touch
emulation and mocked `visualViewport` geometry do not replace these checks.

Touch region dragging still competes with scrolling in comment mode. Native
touch text selection and off-slide navigation are not changed in this first
responsive-shell slice.
