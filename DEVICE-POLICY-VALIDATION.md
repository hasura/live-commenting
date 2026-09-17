# v4 device policy — implementation and validation

**Implemented and deployed:** `62af2b9` on local branch `v4`.  
**Fixture build:** `v4-device-policy-20260917T162855Z`.  
No push or PR. September 17, 2026.

## Delivered

- One shared `fixture/src/annotations/device.ts` module: browser characteristics, profile resolution, derived behavior flags, per-instance provider and hook.
- All previous width-based interaction checks replaced with those shared flags. Removed the ambiguous `viewport.ts` helper.
- Compact layout remains CSS width **<480px**: bottom sheet, 2px gaps, 80% maximum height, toolbar hidden while a popup is present.
- Desktop defaults to Enter sends, outside dismissal and no-scroll composer autofocus.
- Mobile/unknown defaults to Enter newline, outside-popup protection and native composer-focus scrolling.
- Public `interaction.deviceProfile` and `interaction.enterBehavior` overrides. Enter overrides do not change dismissal or focus scrolling.
- Updated `SPEC.md`, integration instructions and the prior design report.

## Verification

| Coverage | Result |
|---|---|
| Pure classifier, derived flags, overrides and SSR-safe characteristics | 161 assertions passed |
| Public API integration, live preference updates and standalone composer | 26 assertions passed |
| Desktop popup interactions, including narrow layouts and resizing | 142 assertions passed |
| Mobile popup interactions, including wide layouts, target taps and drags | 194 assertions passed |
| Compact geometry and popup lifecycle | 160 assertions passed |
| Cross-profile audit | 12 profile/popup combinations passed |
| Existing fixture, annotations, advanced, ergonomics, image-example, compact-toolbar, thread-cards, shared-app and server suites | All 9 passed |
| App and reusable-library builds | Passed |
| Deployed fixture | Readiness 204; served JS/CSS byte-identical to build |
| Persistence | All 16 saved event rows unchanged |

The targeted suites contain **683 assertions** in total. Browser tests reported no exceptions. All mutations during validation used isolated test state, not the shared fixture.

Profile coverage includes desktop narrow/wide, iPhone narrow/wide, iPad's Mac-UA heuristic, Windows touchscreen laptop, Android phone/tablet and unknown defaults. Classifier-only cases are not physical-device tests.

## Review comment collation

Reviewer: this bot's direct code inspection and automated checks. No external coding/review sessions were used.

| Review point | Disposition |
|---|---|
| Every interaction consumer must use the same derived flags | Composer, both outside-dismiss handlers and annotation click/drag guards share the per-instance policy |
| A false browser mobile hint must not exclude tablets | iOS/Android and iPad Mac-UA checks precede desktop recognition; covered by tests |
| Touch capability must not turn desktop laptops into mobile devices | Windows touchscreen coverage remains desktop |
| Resizing must not change Enter or destroy drafts | Both profiles preserve text, focus and policy across the 479/480 boundary; no repeated autofocus |
| Enter override must not alter platform scrolling/dismissal | Explicit mobile-send and desktop-newline override tests passed |
| Mobile outside interaction must not indirectly replace the popup | Tap and region-drag guards tested at narrow and wide widths |
| Live state must survive deployment | Before/after event rows identical |
| Prior bubble/tray accessibility and keyboard-toggle differences | Intentionally unchanged; still a separate review item |

During test development, failures were traced to test setup: escaped newline expectations, optimized-module import shape, and test targets covered by the popup. Those harness issues were corrected before rerunning. No failed check is counted as a pass.

## Limits and unchanged scope

- Device classification is heuristic, **not** physical-versus-onscreen keyboard detection.
- Physical iPhone keyboard visibility inside the PromptQL artifact viewer remains unverified conclusively.
- No new preference control in the toolbar; the override is a library/host configuration API.
- No native host bridge, VisualViewport repositioning or keyboard workaround added.
- Popup-type focus/Tab/keyboard-Hide differences remain separately unapproved.
- Temporary fixture hiding and debug-toolbar flags remain deliberately enabled. Pre-push cleanup and push authorization are still required.