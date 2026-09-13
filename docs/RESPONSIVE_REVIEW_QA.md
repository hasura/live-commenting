# Responsive review shell: first-slice QA

Scope: full-width blue header, compact footer discussion/composer, measured host
insets, minimize/resume drafts, typed host-owned send states, and integration docs.
No document schema or backend change.

## Reproduction

See `fixture/LAB.md`. Start the Vite fixture on 5180, snapshot the baseline and
candidate, serve the static lab on 5188, and attach headed Chromium over CDP.

- `check-responsive-review.mjs`: all 18 cases passed (three fixtures × six sizes).
- `check-review-lifecycle.mjs`: 13 passed.
- `check-lab-embedded.mjs`: 5 passed.
- Existing suites: fixture 20, annotations 48, advanced 23, ergonomics 15.
- Typecheck, app build and packaged-library build pass.

The additional annotations/ergonomics assertions explicitly cover the changed
Escape semantics: minimize, exact text on resume, explicit Cancel. Resolved
filters moved into the overflow menu; their test selector was updated.

Results/screenshots are generated in `fixture/public-lab/evidence/` (gitignored).
The lab report serves links to raw JSON and images; no golden screenshots are
used to bless the defects found in the baseline.

## Performance diagnostic

A local headed Chromium run with 120 stored discussions, 20 rendered pins and
90 scroll frames measured:

| | Median frame interval | p95 interval | Target measurements |
|---|---:|---:|---:|
| Baseline | 16.5 ms | 17.5 ms | 858 |
| Candidate | 16.5 ms | 17.5 ms | 924 |

This is a small local diagnostic, not a production performance claim. The
candidate adds viewport/inset observation while keeping the existing
needed-target geometry pipeline and shared listeners, not per-pin listeners.

## Limitations / release gates

- Chromium touch emulation is not physical iOS Safari / Android Chrome.
- The visualViewport test overrides geometry and dispatches a resize event;
  it does not open a real software keyboard.
- Native selection handles, safe-area hardware and browser chrome need device QA.
- Live send/authorization tests were not run; the lab simulates success/failure.
- Unposted editor state survives minimize/resize, not reload or host unmount.
- Touch region-vs-scroll and off-slide navigation remain separate follow-ups.
- Existing hosts must reserve the measured insets and offset sticky headers.
- No merge, release or package publication is part of this candidate.

## Product-wiki companion for release

The canonical integration guidance shipped with the library is `INSTRUCTIONS.md`.
When this candidate is released, update the product wiki's Live Commenting
annotation-UI conventions to match these shipped contracts:

- Replace floating-toolbar guidance with the full-width blue header and required
  host inset integration.
- Document compact footer / desktop popover behavior, mode visibility, explicit
  Cancel vs incidental minimize, and no automatic textarea reload persistence.
- Describe host-confirmed sending state and the open-editor guard.
- Link the updated skill instructions; retain physical-device limitations until
  independently tested.

Do not describe planned touch-selection or deck-navigation changes as shipped.
