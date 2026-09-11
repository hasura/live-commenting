# Prior art

Reference clones for the annotation layer. All `--depth 1`; `react` and
`storybook` are sparse-checked-out to the one directory worth reading.
Re-run or repair with `./clone.sh` (idempotent — skips what's present).

**Nothing here is a dependency.** These are read-only references. Licences are
noted because some of it is copyable and some isn't.

## Element mode — the primary case

The useful realisation: the best prior art for "resolve a pointer to a
meaningful element and outline it" is **not** annotation libraries. It's
devtools inspectors, which have solved exactly this several times.

| Dir | Licence | Read this | For |
|---|---|---|---|
| `react/` | MIT | `packages/react-devtools-shared/src/backend/views/Highlighter/{Overlay.js,Highlighter.js}` | *The* reference for hover-outline + label over arbitrary nested elements. Closest existing thing to the hit-test problem here. |
| `storybook/` | MIT | `code/core/src/highlight/{useHighlights.ts,utils.ts}` | Element-highlight API inside a host app. The old `measure` addon lives here now. |
| `siteping/` | MIT | `packages/widget` | The only full open-source element-pin comment flow. Shadow-DOM isolation, %-relative rects, anchor descriptor shape. |
| `floating-ui/` | MIT | `packages/dom/src/{autoUpdate,middleware}` | Bubble placement, collision, anchor tracking. The fiddly part, already solved. |
| `figma-clone/` | **none** | `CommentsOverlay`, `PinnedThread`, `useMaxZIndex` | Pin+thread overlay structure. **No LICENSE file — read the shape, do not copy code.** |

## Text mode

| Dir | Licence | Read this | For |
|---|---|---|---|
| `text-annotator/` | BSD-3 | `packages/text-annotator/src/rendering/renderer-css-highlight/`, `utils/annotation/range-to-selector.ts`, `packages/text-annotator-react/` | The library to adopt if `mode="text"` enters scope. `TextAnnotationPopup` is the headless popup seam. |
| `hypothesis/` | BSD-2 | `src/annotator/anchoring/`, `src/annotator/bucket-bar.tsx`, `src/annotator/highlight-clusters.tsx` | Reference selector cascade. Also two UX gems nobody copies: the margin rail showing where off-screen comments are, and overlap styling. |
| `web-highlighter/` | MIT | `src/` | Zero-dep, readable in an hour. The span-wrapping approach this library does *not* use — read to know why. |
| `apache-annotator/` | Apache-2.0 | `packages/dom/src/text-quote/describe.ts` | `describeTextQuote` expands prefix/suffix until the selector is provably unambiguous. Best algorithm in the space. Project archived Aug 2025; the code is still good and the licence permits lifting it. |

## Image mode — deferred

| Dir | Licence | Read this |
|---|---|---|
| `annotorious/` | BSD-3 | `packages/annotorious/src` — rect/polygon editors, `W3CImageFormat` crosswalk |

## Deliberately absent

- **`taskmapr/ui-overlay`** — 3 stars, no licence. Looked, not worth it.
- **marker.js** — core is "linkware" (logo unless you pay). Fails a
  permissive-licence gate even though marker.js *UI* is MIT.
- **tldraw** — excellent selection/handle code, non-OSS licence.
- **Liveblocks Comments** — not open source. They released the sync engine
  (AGPL) and explicitly excluded Comments and Notifications.
