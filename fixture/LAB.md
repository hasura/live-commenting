# Desktop & mobile commenting lab

Purpose: iterate on library ergonomics against realistic generated artifacts without posting QA comments to a real bot.

## Isolation

- `lab.html` is a separate Vite entry point; the original fixture and its planted hit-test cases are unchanged.
- Three fixtures: `spec` (prose, table, sticky header, image), `ui` (buttons, fields, nested scrolling), `deck` (16:9 slides, slide navigation, conditional targets).
- Annotation source is shared with the real library. The baseline snapshot currently uses unmodified public release `f1f7349`.
- Browser-local documents are isolated by `mobile-lab-{fixture}-v1`; use **Test controls → Reset this fixture**.
- **Save all is a simulation**, including busy/failure/success/round locking. It calls no network API. It does NOT test upstream authorization, delivery, or collaboration.
- The lab service is static, needs no credentials, and publishes no platform permissions.
- Known baseline defects are observations in `evidence/*.json`, not accepted behavior or golden UX tests.

## Run and freeze

```sh
cd fixture
npm ci
npm run dev -- --host 0.0.0.0 --port 5180 --strictPort
# Visit http://localhost:5180/lab.html?fixture=spec (or ui, deck)
```

In another shell, build a baseline once and start the static lab:

```sh
node scripts/snapshot-lab.mjs baseline
node lab-server.mjs
# http://localhost:5188/
```

`baseline` is guarded against accidental replacement. To preview subsequent work:

```sh
node scripts/snapshot-lab.mjs candidate
# http://localhost:5188/candidate/lab.html?fixture=spec
LAB_URL=http://127.0.0.1:5188/candidate/lab.html TEST_OUTPUT_DIR=public-lab/evidence/candidate node scripts/check-mobile-lab.mjs
```

The generated `baseline/`, `candidate/`, and `evidence/` directories are ignored by Git. The portal, report, fixture source, and scripts are versioned.

For persistent deployment use an enabled systemd unit (not a transient process):

```ini
[Unit]
Description=Live commenting review lab
After=network.target
[Service]
User=promptql
WorkingDirectory=/workspace/skill-live-commenting/fixture
ExecStart=/usr/bin/env node lab-server.mjs
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
```

Verify `systemctl is-enabled live-commenting-lab` and `GET /readyz` returns 204. The service checks the baseline exists before listening.

## Browser checks

Use a headed Chrome CDP session (`promptql-browser-cdp` on the bot VM), then:

```sh
node scripts/check-mobile-lab.mjs
node scripts/check-mobile-interactions.mjs
node scripts/check-lab-embedded.mjs
```

The first suite covers 3 artifacts × 6 viewports, real pointer/touch interactions, create/read/reply, and records geometry plus screenshots. It exits nonzero on broken smoke flows. The second is an observational baseline audit of specific interactions; read its JSON and errors, rather than treating exit 0 as proof of desired UX. The embedded suite asserts resizing retains drafts, separate fixture state, restored comments, and image loading.

Sizes: 1440×900 desktop, 768×900 narrow pane, 390×844 phone, 320×568 small phone, 844×390 landscape, 390×422 short embedded viewport.

The portal's viewport control resizes an iframe; it does NOT emulate a phone. The automated suite separately uses Chromium `isMobile` + `hasTouch` and CDP touch gestures. Neither simulates a physical keyboard, iOS Safari selection UI, browser bars, or host-console authentication. Those require manual device QA.

Existing regression suites (dev server port 5180):

```sh
CDP_URL=http://127.0.0.1:9222 node scripts/check-fixture.mjs
CDP_URL=http://127.0.0.1:9222 node scripts/check-annotations.mjs
node scripts/check-advanced.mjs
node scripts/check-ergonomics.mjs
```

Do not run `check-app.mjs` for this exercise: it posts a real review.
