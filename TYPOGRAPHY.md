# Commenting typography

The reusable annotation layer uses a complete, scoped font contract. It does
not restyle the artifact's document or developer inspector.

| Token (`--ca-font-*`) | Size / line height | Weight | Use |
|---|---|---|---|
| heading | 16 / 24 | 600 | Target heading |
| input | 16 / 24 | 400 | Composer and placeholder |
| body | 14 / 20 | 400 | Comment and reply prose |
| note | 14 / 20 | 400 | Resolution notes, soft ink |
| label | 14 / 20 | 600 | Author and grouped headings |
| action | 14 / 20 | 500 | Toolbar, buttons, widen |
| meta | 12 / 16 | 400 | Time and keyboard hints |
| compact | 12 / 16 | 600 | Badges, counts, initials |
| number | 12 / 16 | 700 | Marker, tabular figures |
| status | 12 / 16 | 700 | Uppercase status, .04em tracking |
| keycap | 12 / 16 | 500 | Reserved monospace keyboard keycap |
| tooltip | 12 / 16 | 400 | Inverse portaled tooltip |

Use the shared system-sans family, normal style/caps/numeric variants, zero
tracking, and no text transformation except for the stated variants. The
standalone composer, tooltip portal, and host notifications initialize their
own tokens instead of inheriting the host's font. Sizes do not shrink on mobile.

Semantic colors: ink `#0f172a`, soft `#475569`, placeholder/resolved marker
`#64748b`, accent `#2563eb`, strong accent `#1d4ed8`, inverse white, success
`#047857`, warning `#b45309`. State surfaces complement text/icons, not replace
them. Disabled control opacity stays intentional. Resolved marker white-on-gray
contrast is 4.76:1; toolbar hover/count surfaces use strong blue to preserve
contrast. Markers grow horizontally for long numbers while retaining their anchor.

Host-facing review banner and Sonner use the same contract. Scoped Sonner
selectors intentionally override its styled defaults (including browser-default
action-button family). Action buttons have at least 32px height.

## Validation

Run the fixture development server on 5180, then:

```sh
node scripts/check-typography.mjs
```

Override `FIXTURE_URL` or `TEST_OUTPUT_DIR` as needed. This mounts real exported
components without posting shared comments and verifies desktop/375px computed
styles, standalone inheritance, tooltip portals, placeholders, status styles,
Sonner specificity, long markers, and selected/hover colors.

Regression coverage also includes the fixture, annotations, device policy,
device integration, compact toolbar, mobile popups, resolve popup, server,
shared app, advanced, ergonomics, image example, popup interactions, and
discussion-card suites. Older assertions for 14px headings, synthetic small caps,
and banner #111 were updated to the approved contract; behavior assertions remain.
