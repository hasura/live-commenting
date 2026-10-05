# Changelog

## 6.1.0 — 2026-10-05

- A unified Comments reader shows full histories in page order, with fully
  unanchored discussions badged and listed last. All/Open/Resolved
  filtering defaults to All and applies to both reader and markers.
- The toolbar separates comment creation, the reader and marker visibility.
  Mode and visibility changes retain the current popup and editor; popup
  navigation preserves both controls. All comment popups dismiss on desktop
  outside clicks and protect against mobile/tablet background taps.
- Compact status badges identify Open and Resolved filters without lengthening
  the Comments button. The tooltip and accessible label name the filter; the
  count reflects the filtered discussions.
- Reader position survives filtering, closing/reopening and Show on page /
  Back to comments navigation. The reader includes saved chart images and data
  details; chart anchor loss preserves an active popup reply.
- Mobile/tablet markers grow to 36px while desktop markers remain 24px. Marker
  placement and popup geometry use the same device-specific size.
- One active editor serves both new comments and replies. Starting another or
  closing its view discards unsent text; pending saves are protected and failures
  keep the current text. Escape dismisses the popup after any open mention picker.
- Only discussions with no usable reference are marked unanchored. Resolve and
  reopen retain their popup until a confirmed status change filters it away.

### Compatibility

This is a compatible addition to the 6.0.0 integration. The host/server protocol,
persisted annotation schema and PromptQL interfaces are unchanged. No SQLite
migration is required; existing discussion history and image snapshots remain intact.

## 6.0.0 — unpublished charts baseline

This baseline reached main before the first SemVer release tag. It consolidated
the unpublished `0.4.x` development builds and `0.5.0` candidate, and established
`fixture/package.json` as the source for package versions and `v<version>` tags.

- Charts expose stable data identities and current geometry through one adapter
  contract across SVG, Canvas and WebGL. Click selects a mark; drag records a
  fixed set of members. Reordering, changed values and relayout preserve identity.
- Rectangle comments on charts and ordinary images retain the original PNG crop.
  The server saves image bytes and the opening event atomically in SQLite;
  polling carries hashes rather than image bytes. The bot can retrieve images
  with `anno.mjs snapshot <id> <path>`.
- Point clicks outline their mark. Rectangles show an enclosure and marker, with
  no per-member outlines. The enclosure follows surviving members; newly added
  data never joins an existing selection.
- When no selected member is visible in the chart, the discussion moves to
  Unanchored. Returning members restore the anchor. Open replies survive these
  transitions, and deep links open the correct discussion. Page scrolling and
  collapsed sections only affect marker visibility.
- Discussion details show the original image first. Multiple members share one
  “N data points” disclosure; a single point shows its original values directly.
  Current availability and changed values remain separate from saved context.
- Titles, subtitles, HTML legends, controls and SVG labels use ordinary annotation
  IDs with chart context. In-chart labels are click-only; axes and Canvas-only
  labels are outside this element-targeting scope.
- Explicit image-only selection covers charts without reliable membership.
  Capture failures retain the draft and block posting until resolved. An empty
  region is distinct from unavailable membership.
- Centred DOM charts capture their border-box pixels without inheriting outer
  margins. Existing snapshots remain immutable; this fix does not reconstruct
  images that an earlier build already captured blank.
- New `live-commenting/chart` and `live-commenting/chart-adapters` exports provide
  independent contracts and geometry helpers without importing the annotation
  runtime or bundling chart libraries. The fixture provides simple recipes and
  advanced SVG/Canvas cases, plus opt-in Three.js coverage.
- `INSTRUCTIONS.md` includes a renderer-independent integration checklist, stable
  identity rules, component annotation patterns, snapshots, and bot access.

### Integration and upgrade

Use the browser library, host integration, review server (`server.mjs` and
`server/`) and bot CLI from the same release. Preserve the persistent data
directory; startup retains the existing discussion history and image snapshots.
The integration guide documents the current setup without requiring an agent to
manage internal compatibility counters.

### Documentation and distribution

- `INSTRUCTIONS.md` is now a focused guide for integrating a JavaScript SPA:
  existing host/server interfaces, PromptQL credentials, target attributes,
  chart adapters, deployment, bot access and validation. Minimal examples link
  to complete fixture implementations.
- Package archives are generated install artifacts, not committed source files.
  A template app can use this repository directly; a separate app installs the
  browser package and reuses the matching server and CLI.

## Earlier project milestones

These are historical checkpoints, not newly created release tags. Git history
and existing branch tips establish the following linear sequence:

| Milestone | Checkpoint | What changed |
|---|---|---|
| v1 | `661189b` — September 11, 2026 | Initial element-anchored commenting layer and annotated fixture |
| v2 | `f1f7349` — September 11, 2026 | Text/image selection, packaged browser library, review rounds and review app |
| v3 | `75895f2` — September 16, 2026, `v0.3-server-persisted` branch | Shared server persistence, event history, presence and build refresh |
| v4 | `0a4cfe3` — September 2026, `v4` branch | Toolbar and popup refinements, compact layouts and device input policy |
| v5 | `28dc9fc` — September 24, 2026, `v5` branch | Explicit mentions and bot dispatch, rich comments, live presence, the real-server development harness and stable editors |

The parallel `0.x` numbers were package/build counters, not a second reliable
project release history: v2 generated a `0.2.0` package while its fixture manifest
still said `0.1.0`; v3 reached `0.3.8`, which remained in the manifests through v4
and v5. New development no longer creates entries in that separate sequence.
The original commits and branch names are retained unchanged.
