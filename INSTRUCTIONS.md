# Using the annotation layer

For agents generating an artifact that should be commentable, and wiring the
layer onto it. Reference implementation: `fixture/`.

Implemented: element references, block-scoped text selection, fractional image regions,
semantic flattening, and an event-log model for server-backed hosts. The host still
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
- When regenerating an artifact, **preserve every id whose block still exists.**
  A block rewritten *in response to a comment* keeps its id — that is exactly the
  block the discussion is about, and the reviewer expects to find their comment on
  the new wording. Mint a new id only for genuinely new content.
- An id that does not reappear makes its comments **unanchored**: they stay
  readable in the tray (label, quote and semantic payload were snapshotted at
  creation) but have nothing to point at. Text refs whose quote no longer matches
  behave the same way. There is no fuzzy relocation, by design.

That protocol is verifiable — diff the id sets between two versions — which is
why it replaces fuzzy text matching entirely.

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

  const onChange = useCallback((next: AnnotationDoc) => {
    setDoc(next);
    save(next);                     // yours: file, API, event log (§11), localStorage…
  }, []);

  return (
    <>
      <div id="artifact-root" ref={rootRef}>
        <YourArtifact />
      </div>
      <Annotations
        root={root}
        annotations={doc}
        onChange={onChange}
        author={{ id: 'user-1', name: 'Ada Okonjo' }}
      />
    </>
  );
}
```

`root` is `null` on the first render — that's expected and handled.

### Props

| Prop | Required | Notes |
|---|---|---|
| `root` | yes | The artifact element. Targets outside it are ignored. |
| `annotations` | yes | The document. |
| `onChange` | yes | Receives a **new** document. Persist it here. |
| `author` | yes | `{ id, name }`, stamped onto comments. |
| `composer` | no | Swap the composer — see §8. Defaults to `TextComposer`. |
| `portalTo` | no | Where toolbar and popovers mount. Defaults to `document.body`. |
| `toolbarActions` | no | Extra host controls in the toolbar. Use `data-anno-preserve-draft` when clicking must not dismiss a draft. |
| `readOnly` | no | Prevents document edits; viewing remains available. |
| `interaction` | no | `{ deviceProfile?, enterBehavior? }` overrides for device defaults, independent of layout. See below. |

If you'd rather not hold state, `useAnnotations(initial?)` returns
`{ doc, setDoc, reset }` — sugar over the controlled path, same as
`defaultValue` on an input.

### Device behavior and compact layout

Layout is width-based: below **480 CSS px**, popups become bottom sheets and
hide the toolbar while open. A narrow desktop iframe still gets this layout.

Input behavior is **not** width-based. Desktop Enter sends, Shift+Enter adds a
newline; phones/tablets use Enter for a newline and the Comment/Reply button to
send. Desktop outside presses dismiss; mobile outside presses preserve the
popup. Mobile composer autofocus allows native scrolling; desktop keeps
no-scroll focus. Unknown devices use conservative mobile-like defaults.

The shared device-policy helper uses browser mobile/platform hints, iOS/Android
UA checks and a Mac-UA plus multi-touch iPad heuristic. It does not reliably
identify a physical keyboard. Touchscreen Windows laptops remain desktop.
A host that knows more can override the defaults without changing layout:

```tsx
<Annotations
  root={root}
  annotations={doc}
  onChange={setDoc}
  author={author}
  interaction={{ deviceProfile: 'mobile', enterBehavior: 'send' }}
/>
```

- `deviceProfile`: `'auto'` (default), `'desktop'`, `'mobile'`, or `'unknown'`.
- `enterBehavior`: `'auto'` (default), `'send'`, or `'newline'`.
- Use `enterBehavior` for a host's explicit Enter-sends preference; no preference
  control is added to the fixture toolbar.
- An Enter-only override does not affect dismissal or focus scrolling.
- Configuration is per annotation instance, never a global mutable setting.
  Changing it preserves the composer and its text; it does not repeat autofocus.
- Custom composers inside the layer can call `useDeviceBehavior()`. A standalone
  `TextComposer` uses the same default resolver; wrap it in
  `DeviceBehaviorProvider overrides={...}` for explicit configuration.
- The package also exports `readDeviceCharacteristics`, `detectDeviceProfile`
  and `deriveDeviceBehavior` for hosts needing the same pure policy logic.

Do not infer this policy from iframe width, hover, touch support alone, or the
most recent keyboard/pointer event. The library assumes no native-app bridge.

---

## 7. The document

Initial state is `emptyDoc()`:

```json
{ "version": 1, "threads": [] }
```

Full shape after a comment and a reply:

```json
{
  "version": 1,
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
- `status` is `open | resolved` — the fold of the thread's status entries. A
  resolved thread also carries `resolution` (`{ actor, actorKind, at, note? }`)
  for convenience; reopening clears it.
- `log` is the thread's full history in order: `CommentEntry` and `StatusEntry`
  (`kind: 'resolve' | 'reopen'`, `actor`, `actorKind: 'user' | 'bot'`, `at`,
  `note?`) interleaved as they happened. The popover renders the log as one
  conversation — a resolve or reopen is a message row whose body is the status
  word in small caps. Replying to a resolved thread appends a reopen entry by
  the replier, then the comment.
- Comments are immutable and threads are never deleted; resolve/reopen is the
  only lifecycle.

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

The development fixture uses `localStorage` as a stand-in. The production review app
keeps an append-only event log on a server instead and folds it into the document —
see §11. That is host code, not library persistence.

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
`placeholder` and `submitLabel` if you want those to differ.

---

## 9. Interaction contract (what users get)

Worth knowing so you don't rebuild it:

- **`C`** or the toolbar toggles comment **mode** — a mode, not a one-shot
  action, because a review pass is many comments.
- In comment mode a click means *"comment on this"*, never *"activate this"*.
  Clicks are suppressed in the capture phase, so your buttons and links are safe.
- Hover outlines the **resolved** target and names it, so the user sees what they
  are about to comment on before clicking.
- **`Enter`** saves, **`Shift+Enter`** newlines.
- **`Esc`** is layered: discards a draft, then closes a popover, then leaves
  comment mode. One keystroke never costs both a draft and the mode.
- Entering comment mode forces pins visible (so you reply instead of
  duplicating) and restores the prior setting on exit.
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

- [ ] Ids preserved for every block that still exists — including blocks rewritten in response to a comment
- [ ] New ids only for genuinely new content
- [ ] Id sets diffed against the previous version to confirm the above

## 11. Text, regions, the event log, and the bot

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

### The event log (server-backed hosts)

A shared review should not have a draft, a Save button or a publish step: a
comment is shared the moment it is posted, and the owning bot is just another
reader. `events.ts` gives a host the two halves of that:

```ts
import { foldEvents, diffDoc, type AnnotationEvent, type LocalEvent } from './annotations';

const doc = foldEvents(events);                 // AnnotationEvent[] → AnnotationDoc
const local: LocalEvent[] = diffDoc(prev, next); // what an onChange means, as events
```

- `AnnotationEvent` is one row of an append-only log: `seq` (server-assigned,
  the only ordering), `id` (client idempotency key, becomes the comment id),
  `thread_id`, `kind: 'comment' | 'resolve' | 'reopen'`, `actor: {id, name, kind:
  'user' | 'bot'}`, `body?`, `refs?`/`pin?` (opening comment only), `created_at`.
- `foldEvents` is the document; nothing else is stored. `applyEvent` is the
  single-step version for merging a poll result.
- `diffDoc` turns the document `onChange` hands back into events (new thread →
  a `comment` carrying `refs`; reply → a `comment`; status flip → `resolve` /
  `reopen`). The host posts each one; deletions and edits are not expressible,
  which is the point.
- "What has the bot read" is a cursor (a `seq`), not a per-thread column.

`fixture/src/App.tsx` (`SharedHost`) and `fixture/server.mjs` are the reference:
polling `since=<seq>`, optimistic append, toasts for other people's events, a
`resolution` marker for bot resolves, and one short `send_system_message`
doorbell that tells the bot to pull pending comments with `anno.mjs unread`
(see the root `README.md`, "How a review works").

`flattenAnnotations(doc)` produces prompt-ready text from ref labels, semantics,
quotes, regions, comments and resolutions. It needs no DOM. For Node callers,
import it from `collaborative-html-annotation/review`; the event helpers are
`collaborative-html-annotation/events`.

### For the bot: `anno.mjs`

When the review app runs on the bot's VM, the bot talks to it over a Unix socket
with `fixture/scripts/anno.mjs` — one call, one event, synchronous:

```sh
node scripts/anno.mjs unread              # everything you have not read, as a digest; advances your cursor (and cancels any pending nudge)
node scripts/anno.mjs unread --peek       # same, cursor untouched
node scripts/anno.mjs threads [--all]     # thread ids with status, target and opening comment
node scripts/anno.mjs resolve <thread-id> [note]   # → {"seq": n}; 409 if already resolved (exit 3), 404 unknown (exit 4)
node scripts/anno.mjs reopen  <thread-id> [note]
```

**Always run `unread` before beginning any work on the owning bot** — first
command of every interaction, whether or not a review nudge woke you. The nudge
(a system message reading `Review nudge … N new messages …`) carries no comment
text: it names this command by absolute path and asks you to reply `Read N
messages.` plus a 2–3 sentence summary. Nudges are only *sent* while a reviewer
has a tab open (and at most one per new batch, 1 minute after its oldest
comment), so running `unread` unprompted is how nothing gets lost; it is one
shell command. Pass
`--id <uuid>` to make a retried `resolve`/`reopen` idempotent. A bot resolve shows
up for reviewers within a poll as a log row "<bot> · resolved · note",
with **Reopen** (a reply also reopens).
Bot-authored comments are off in v1 (`BOT_COMMENTS=1` enables the endpoint).

**When you change the served app**, rebuild and then **restart the review
server** — `BUILD_ID` (and the fallback start-time id) is read once at start, so
without a restart open tabs keep the old bundle and never see the red ⟳ refresh
control. Optionally set `BUILD_ID=<git sha>` in the unit env before restarting.
`runtime-state/` survives the restart.

### Packaged consumption

```ts
import { Annotations, emptyDoc } from 'collaborative-html-annotation';
import 'collaborative-html-annotation/annotations.css';
// Generated content imports only this independent helper:
import { anno } from 'collaborative-html-annotation/anno';
```

Peer dependencies: React 19, React DOM 19, Floating UI React 0.27.
A ready-made non-text composer and margin rail are optional future UI work.
