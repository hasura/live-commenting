import type { Author } from '../annotations';

/**
 * Development-only banner. Shows which fake identity the harness
 * (`scripts/dev-server.mjs`) signed you in as. `App.tsx` renders it behind
 * `import.meta.env.DEV`, so it is absent from `npm run build` and therefore
 * from the published review app.
 *
 * This is NOT part of the annotation layer and NOT part of the host contract
 * in INSTRUCTIONS.md §6. Do not carry it into another app artifact: a published
 * app already knows who its viewer is (the gateway authenticates every
 * request); the banner exists only because that identity is faked in
 * development.
 */
export function DevBanner({ user }: { user: Author | null }) {
  return (
    <aside className="dev-banner" data-anno-ignore="">
      <strong>Live commenting — development harness</strong>
      <span className="dev-banner-line">
        Signed in as {user?.name ?? '…'} (fake development identity; this banner is not in the built app)
      </span>
    </aside>
  );
}