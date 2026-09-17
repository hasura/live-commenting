# v4 resolve-popup lifecycle fix

## Behavior

With resolved threads hidden, resolving the **last visible annotation thread**
now closes its bubble or unanchored popup, rather than only filtering it out.
**Show resolved does not reopen that popup.** Opening it explicitly still works.

- Other visible threads remain: keep the grouped popup open.
- Resolved threads already shown: keep the popup open after Resolve.
- Compact layout: closing restores the toolbar.
- Existing device policy, focus behavior, persistence and status history remain unchanged.

## Cause and fix

The resolved filter removed the rendered popup, but left its selected thread IDs
or unanchored-toggle state active. Re-enabling resolved threads restored the
popup from that stale selection.

Both popup types now share the resolve handler. It clears the relevant selection
when the clicked thread is the last visible card and resolved threads are hidden,
then performs the existing status update.

This is deliberately tied to the **Resolve action**. It does not broadly clear
popup selection when anchors become temporarily unmeasurable or filters change.

## Regression evidence

`check-resolve-popup.mjs` reproduced the resurrection before the fix. Afterward,
**129 assertions passed**, with no browser exceptions, across:

- Desktop and mobile browser profiles at 375px and 1400px.
- Bubble and unanchored popups.
- A single thread, including a hidden resolved sibling.
- Grouped popup: first resolve keeps the remaining card; final resolve closes.
- Show resolved cannot resurrect a closed popup; explicit opening still works.
- Resolved-shown behavior, Reopen, read-only attempts, comment preservation and
  exactly one resolve event.

Keyboard activation of the resolved filter prevents desktop outside-pointer
dismissal from hiding the original bug. Tests use an isolated controlled host,
not the live fixture's comments.

## Review comment collation

Reviewer: this bot's direct code inspection and automated checks; no external
review sessions.

| Review point | Disposition |
|---|---|
| Filtering is not closure | Clear the popup's selection during the Resolve action |
| Match both popup types | Shared handler for bubble and unanchored popups |
| Count visible cards, not all historical threads | Hidden resolved siblings do not prevent closure |
| Do not close a group prematurely | Keep open when other visible threads remain |
| Preserve the resolved-shown workflow | Resolve and Reopen retain the popup |
| Keep read-only behavior | No status update or closure on a read-only attempt |
| Avoid broad anchor-lifecycle changes | No effect that closes every temporarily missing popup |

Implementation commit: `b670729`, local branch `v4`. No push or PR.
## Build, regression and deployment

- App and reusable-library builds passed.
- All 11 additional suites passed: fixture, annotations, advanced, ergonomics,
  image-example, compact-toolbar, thread-cards, mobile-popups,
  device-integration, shared-app and server.
- Fixture readiness: HTTP 204; served JavaScript and CSS match the build byte-for-byte.
- All 36 pre-existing saved events remain unchanged; 0 new events since snapshot.
- No live comments were created or changed by the tests.
- Deployed build: `v4-resolve-popup-20260917T164742Z`.
