# Changelog

## v5 (September 2026, `fixture/package.json` 0.3.8, package `live-commenting`)

- Comments reach the bot only when a reviewer asks: an inline `@` mention of the
  bot, or "Post directly to {bot name}". One chat receipt per such comment, sent
  once after durable save with the submitting viewer's credentials
  (`agentResponseConfig` `force_respond`; human-only mentions notify without
  invoking, `force_skip`). Failures append an `error` event and read "Sending
  failed, ping {bot name} in chat to retry."
- Removed the v4 pull model: nudges ("Review nudge …"), bot read cursors,
  "N pending · Sync now", `anno.mjs unread`, `SYNC_MAX_AGE_MS`, `SYNC_MAX_COUNT`,
  `ANNO_CLI`, `BOT_COMMENTS`, `send_system_message`. The startup migration drops
  the reader/receipt tables and keeps every event.
- `anno.mjs` is `read | reply | resolve | reopen`, with `--id` / `--expected-seq`
  on writes. Protocol version 5; `GET /api/directory`; `MAX_BODY_BYTES` (16 KB).
- Rich comment bodies (Tiptap 3.31.3) with human and bot mentions; "Viewing now"
  presence; mobile/compact layout and device-based input policy; scoped
  typography contract (`--ca-font-*`, see `INSTRUCTIONS.md`).
- The `C` keyboard shortcut for comment mode is gone; use the toolbar.
- The discussion/draft popover no longer jumps to a viewport corner when its own
  height changes (mention picker opening or closing, typing `@`, Backspace,
  Escape): placement keeps its start edge on the target and only nudges.
- An open draft follows its target by id through host rerenders. The outline,
  pin, popover anchor and "Widen" read the element currently in the document,
  not the node captured when the draft opened — a host that recreates its nodes
  under the same ids (re-rendering `dangerouslySetInnerHTML` on every poll, for
  instance) left that node detached, measuring 0×0 at the viewport origin, and
  the next height change dragged the popover to the top-left corner. If the
  target disappears the draft stays open where it was, the heading reads
  "unanchored" with a note that the comment will be filed as unanchored, and it
  re-anchors when the id returns; only the reviewer dismisses a draft.
- The fixture's "Live commenting debug / Signed in" banner is now
  `src/dev/DevBanner.tsx`, rendered only in development: it is gone from the
  built review app, its CSS left the layer's stylesheet (and therefore the
  tarball), and `INSTRUCTIONS.md` §0 now lists the host contract instead of
  "keep `src/App.tsx` as is" — apps built from the instructions were copying
  the banner along.
- Development and the check suites run against the real review server
  (`npm run dev` = `server.mjs` + Vite proxy + fake platform). The localStorage
  development host is gone.
- Package renamed `collaborative-html-annotation` → `live-commenting`
  (never published; install the tarball). Documentation reorganised into
  `README.md` / `INSTRUCTIONS.md` / `AGENT.md`; design and validation scratch
  files removed.

## v4 (September 2026)

- Server-persisted append-only SQLite event log; comments shared live by polling.
- Retired "Save all" and review rounds (the `# Annotation review` chat message
  and `review-<id>` artifact).
- Compact (<480 px) popup layout; centralised device interaction policy.
- Repository renamed from `skill-live-commenting` to `live-commenting`
  (2026-09-22; the old URL redirects).

## v0.3 and earlier

- Element, text-range and image-region references; semantic flattening for
  prompts; the zero-import `anno.ts` artifact contract; the reference fixture
  with ten planted hit-test cases.