# v4 pre-push cleanup

Push authorized by Akshaya on September 17, 2026. Branch: `v4`.

## Cleanup

- Restored the original reference figure and Wireframe navigation link, retaining their annotation IDs.
- Removed temporary hidden-target and always-visible-toolbar overrides.
- Retained normal conditional controls: resolved and unanchored filters when applicable; red Refresh only when the build is stale.
- Missing-target tests now remove elements only inside their isolated browser, then verify reanchoring on reload without changing saved comments.

## Review comment collation

Reviewer: this bot's direct code inspection and automated checks.

| Review point | Disposition |
|---|---|
| Temporary testing changes must not ship enabled | Removed both temporary flags and their fixture overrides |
| Existing annotations must survive restored targets | Original target IDs retained; reanchoring tested without rewriting comments |
| Refresh must signal a stale build, not routine state | Preserved the `debug || stale` gate; fixture no longer enables debug |
| Tests must exercise real conditional controls | Updated zero-state expectations and seeded applicable thread states |
| Local credentials and saved comments must not be pushed | `fixture/app.env` and `fixture/runtime-state` remain ignored and untracked |

Earlier validation reports describe their respective build snapshots; this cleanup supersedes their notes about deliberately enabled temporary flags.
## Validation

- App and reusable-library builds passed.
- All 12 suites passed: fixture, annotations, advanced, ergonomics, image-example,
  compact-toolbar, thread-cards, mobile-popups, resolve-popup, device-integration,
  shared-app and server.
- The first mobile-layout run still expected an empty debug-only unanchored
  control. Its expectation was updated to normal conditional visibility; the
  full suite then passed.
- Live fixture readiness: HTTP 204; served assets match the build.
- All 36 pre-existing saved events preserved unchanged.
- Deployed build: `v4-prepush-20260917T165758Z`.
