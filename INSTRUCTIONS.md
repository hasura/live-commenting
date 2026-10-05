# Integrate live commenting into a PromptQL app

Use this guide when creating or updating a JavaScript SPA that needs live
commenting. Read [README.md](README.md) for the capabilities, selection behavior
and overall design; use this file for the integration steps.

Use the library and review server from the same repository checkout.
Source links below are relative to that checkout; keep it available even when
installing the browser package into another app.

In PromptQL, publish this as a running AppArtifact. An uploaded HTML or image
file alone has no live-commenting server; render that content inside the app.

## 1. Choose how to integrate

**Use this repository as the app.** In [the reference host](fixture/src/App.tsx),
replace `SpecPage` and `ChartExamples` with your artifact. Retain the host's API
integration, annotation mount and error reporting. Run `npm ci` in `fixture/`
before the first build, then `npm run build`; the review server serves
`fixture/dist/`.

**Add commenting to an existing SPA.** Build and install the browser package:

```sh
# In this repository:
cd fixture
npm ci
npm run build:library

# In your app; substitute the package file produced above:
npm install /path/to/live-commenting/fixture/live-commenting-<version>.tgz
```

The `.tgz` is a generated npm package containing the browser library, CSS, type
declarations and chart helpers. It is not committed to Git and is unnecessary
when using this repository directly. It does not contain the review server or
bot CLI; retain [server.mjs](fixture/server.mjs), [server/](fixture/server/), and
[anno.mjs](fixture/scripts/anno.mjs) from the same checkout.

The commenting UI requires React 19, React DOM 19 and `@floating-ui/react` 0.27.
Install those peers if the app does not already provide them. A non-React SPA can
mount just the commenting layer in a separate React root; its artifact can
continue using its own framework. Use Node 24 for the reference server.

## 2. Connect the host and review server

The integration already exists in these files:

| Component | Reuse it for |
|---|---|
| [fixture/src/App.tsx](fixture/src/App.tsx) | Browser API calls, event merging, saves, viewer identity, mention directory, presence and discussion links |
| [fixture/server.mjs](fixture/server.mjs) | SQLite persistence, HTTP endpoints, PromptQL identity and Platform API calls, bot socket |
| [fixture/server/protocol.mjs](fixture/server/protocol.mjs) | Comment validation and PromptQL message formatting |
| [fixture/scripts/anno.mjs](fixture/scripts/anno.mjs) | Bot access to discussions, images, replies and status changes |
| [fixture/scripts/dev-server.mjs](fixture/scripts/dev-server.mjs) | Local test harness with simulated PromptQL identity and API responses |

There is no separate production PromptQL SDK adapter in this repository. The
server implements that boundary directly; the browser talks only to the review
server. Reuse the host's `merge`, `refreshDirectory`, initial-load/poll effect,
`post`, and `change` logic when adapting it to another SPA. Change its
`./annotations` imports to `live-commenting` for an installed package; use your
app's equivalents for its local tooltip/toaster wrappers, or include their
implementation and dependencies (the reference host uses `sonner`). Do not copy the demo,
development inspector or `src/annotations/` implementation into your app.

The host integration does not require a header, sign-in banner or development
identity display. Keep the fixture's `src/dev/` UI out of the published app.

Keep these routes on the SPA's origin:

| Route | Host responsibility |
|---|---|
| `GET /api/state` | Load the authenticated viewer and initial event history |
| `GET /api/events?since=N` | Merge new events by ID and sequence; follow the server's polling interval |
| `GET /api/directory` | Supply the mention directory and refresh callback to `Annotations` |
| `POST /api/event` | Send changes produced by `diffDoc`; merge the returned canonical events |
| `GET /api/snapshots/:id` | Serve recorded selection images through the same authentication boundary |
| `GET /readyz` | AppArtifact readiness probe |

Derive the annotation document with `foldEvents(events)`, not a second store.
Return a promise from `onChange`; resolve after saving and reject on failure.
Merge server responses because they contain authoritative authorship and replace
pending image data URLs with saved image IDs. Preserve the reference host's
handling of delivery errors, stale builds, reconnection and deep links.

Keep the library's structured comment bodies and references intact when saving.
Do not replace them with plain text, editor HTML or Tiptap's internal JSON;
that loses mention identity or selection context.

If the SPA already has a backend, proxy these specific routes to the review
server and retain the app's other routes. Preserve trusted gateway headers.
The server can also serve the SPA's build directly through `ANNO_DIST`.

### PromptQL credentials

| Source | Used by | Purpose |
|---|---|---|
| `PROMPTQL_PLATFORM_API_URL` environment variable | Review server and publishing command | PromptQL Platform API base URL |
| `PROMPTQL_THREAD_ID` environment variable | Review server and publishing command | Owning PromptQL bot/thread |
| `PROMPTQL_USER_JWT` environment variable | Agent's publishing command | Register or update the AppArtifact |
| `x-promptql-visitor-token` request header | Review server | Authenticate each viewer and make Platform API calls as that viewer |
| `x-forwarded-host` / `x-forwarded-proto` headers | Review server | Construct links to the published app |

The gateway supplies the viewer headers. The server forwards that request's
visitor token as a bearer token to PromptQL. Do not use the publishing JWT as a
shared viewer identity, put tokens in the SPA bundle, or implement a client-side
sign-in flow for commenting. Only trust these headers behind the PromptQL
gateway or an authenticating proxy that removes caller-supplied copies.

For local development, `npm run dev` supplies the fake gateway/platform and a
temporary SQLite database. It does not invoke a real bot. Do not publish this
development harness as the app.

## 3. Mount the layer around the artifact

Put generated content under one stable root. Mount annotation UI outside that
root, and import the library stylesheet. The following component receives the
state and callbacks from the host integration described above. Optional props
are defined by [AnnotationsProps](fixture/src/annotations/Annotations.tsx):

```tsx
import { useEffect, useRef, useState } from 'react';
import { Annotations, type AnnotationsProps } from 'live-commenting';
import 'live-commenting/annotations.css';

type Props = Pick<AnnotationsProps,
  'annotations' | 'author' | 'onChange' | 'mentions' | 'readOnly' | 'focus' | 'toolbarActions'>;

export function CommentedArtifact(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setRoot(ref.current), []);

  return <>
    <div id="artifact-root" ref={ref}><YourArtifact /></div>
    <Annotations {...props} root={root} />
  </>;
}
```

`YourArtifact` is the app content. Supply `author` from `/api/state`, keep the
layer read-only until identity loads, and pass the host's mention directory and
refresh callback. Preserve `anno_discussion` and optional `anno_event` URL
parameters by passing them through the `focus` prop, as the reference host does.
If the root DOM node is replaced, update the `root` prop. Mount the layer in the
same document as its targets; another iframe document is not discovered automatically.

For a non-React SPA, create a sibling container outside the artifact root and use
`createRoot(container)` from `react-dom/client` to render `Annotations` there with
the same props. Do not replace the SPA's existing DOM with that React root.

Use [the complete host](fixture/src/App.tsx) for error reporting, build-refresh
controls and optional presence. Its [toaster](fixture/src/ui/sonner.tsx) is one
implementation; an existing app can use its own error reporting. Keep host-only
UI outside the artifact root or mark it `data-anno-ignore`.

For added toolbar controls that should leave an open draft intact, use
`data-anno-preserve-draft`.

Use the standard composer unless the app needs a custom one. Custom composers
follow [ComposerProps](fixture/src/annotations/Composer.tsx), including the
supplied editing session's pending and error state.

## 4. Declare annotation targets

Add attributes to the actual elements a reviewer may reference. The helpers in
[anno.ts](fixture/src/anno.ts) are exported as `live-commenting/anno`; attributes
can also be written directly in HTML. The helpers spread attributes onto existing
elements; do not add wrapper components solely to make content annotatable.

Prefer the smallest meaningful elements a reviewer might discuss: individual
cells, list items, labels, buttons and other sub-elements. Annotate meaningful
containers as well so reviewers can widen their selection. Leave purely
structural or decorative wrappers unannotated.

| Attribute | What to supply |
|---|---|
| `data-anno-id` | Unique, persistent identity within the artifact |
| `data-anno-label` | A readable target name, such as `Revenue summary` |
| `data-anno-mode` | Omit for a whole element; use `text`, `region`, or `chart` as below |
| `data-anno-semantic` | Optional small JSON object with domain context |
| `data-anno-ignore` | Exclude an element and its descendants from commenting |

```tsx
import { anno, annoText, annoRegion } from 'live-commenting/anno';

<section {...anno('revenue.summary', 'Revenue summary')}>
  <h2 {...annoText('revenue.title', 'Revenue title')}>Revenue</h2>
  <p {...annoText('revenue.explanation', 'Revenue explanation')}>...</p>
  <img {...annoRegion('revenue.image', 'Revenue export')}
    src="/revenue.png" alt="Revenue by month" />
</section>
```

- Use ordinary targets for sections, cards, table rows/cells, controls and legends.
- Use `text` on headings or prose where a phrase may be referenced.
- Use `region` on the actual image element. An exported chart with no reliable
  data mapping uses this same image target.
- Use `chart` on one stable plot root and attach an adapter (§5).
- Use ordinary targets for in-chart SVG labels. Leave axes/ticks as part of the
  chart target. Keep labels drawn on data marks associated with their marks by
  default. Canvas-only labels do not get separate targets.
- Nested targets are supported; avoid wrappers that add unnecessary hit areas.

Derive IDs from stable roles or record keys: `revenue.title`,
`orders.<order-id>.amount`, `traffic.legend.<series-id>`. Keep the ID when wording,
values, ordering or position changes. Never use array position, displayed values,
colours or a newly generated random ID on each render. New records get new IDs;
never reuse a removed record's ID for different data.

An element rewritten in response to a comment keeps its ID so that the discussion
remains attached to the updated element.

Labels should name the element in readable terms, such as `EMEA margin cell`;
they need not be unique and are not used to match identity. Labels and semantic
metadata are saved with the comment, so supply enough context to understand it
after the element disappears.

Use semantic metadata for context such as `{rowId, metric, units}`. A chart legend
entry can use `{chartId, role:'legend-item', seriesKey}`. Keep IDs, labels and
semantic values separate.

Study [SpecPage](fixture/src/fixture/SpecPage.tsx),
[DecisionTable](fixture/src/fixture/DecisionTable.tsx),
[SimplePie](fixture/src/fixture/charts/SimplePie.tsx) and
[ImageOnlyExample](fixture/src/fixture/charts/ImageOnlyExample.tsx) for complete
markup examples. Keep the artifact independent of the annotation runtime; it
may import the standalone `anno`, `chart` and `chart-adapters` entry points.

## 5. Connect charts and graphs

For every chart:

1. Give the plot root a stable ID, label and `data-anno-mode="chart"`.
2. Define a selectable unit: observation, bar segment, slice, node, link or
   aggregate cell. Use a source record ID, or a unique combination of stable
   dimensions. For time series, combine series and canonical timestamp/grain;
   for graphs, give nodes and links distinct identities; for bins, identify the
   aggregation and bucket bounds. Mutable values and layout coordinates are not IDs.
3. Return each visible mark's key, label, small JSON `values`, and current geometry.
   Geometry uses CSS pixels relative to the root's border box, including plot
   margins and current transforms. Read it from the chart's actual layout.
4. Register once per chart/root instance. Notify the layer after data changes,
   rendering, resize, filtering, zoom, pan or relayout; dispose on unmount.
5. Supply a native capture function when DOM/canvas capture is insufficient.
   Without reliable membership, use the image-only fallback below.

A minimal time-series bridge, using data and positions supplied by your chart:

```ts
import { anno } from 'live-commenting/anno';
import { registerChart, pointGeometry } from 'live-commenting/chart';

type Row = { date: string; requests: number };

export function attachComments(
  element: HTMLElement,
  chartId: string,
  getRows: () => Row[],
  project: (row: Row) => { x: number; y: number },
) {
  const attrs = anno(chartId, 'Daily requests', { mode: 'chart' });
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);

  return registerChart(element, {
    version: 1,
    getMarks: () => getRows().map(row => {
      const { x, y } = project(row);
      return {
        key: JSON.stringify(['requests', row.date]),
        label: `Requests on ${row.date}`,
        values: { date: row.date, requests: row.requests },
        geometry: pointGeometry(x, y, 4),
      };
    }),
  });
}
```

Here each date is unique within the requests series. `getRows()` must read the
current visible data; `project()` must read current chart geometry. Call the
returned binding's `changed()` after chart updates and `dispose()` on unmount.

Adapter details:

- Use `pointGeometry`, `rectGeometry`, or native paths as defined by
  [the chart contract](fixture/src/chart.ts). Omit marks not rendered in the view.
  If the renderer clips to a rectangular plot, supply `geometry.clip` in the
  same coordinates. Do not infer membership from colours, pixel inspection or
  the order of SVG paths.
- For explicitly tagged SVG shapes, add `data-anno-mark={key}` and use
  `svgMarks(root, members)`. Do not add a separate `data-anno-id` to every mark.
- An optional `capture()` returns a canvas of the **entire chart target**, including
  margins. The library crops it. Use `captureVega` or `captureECharts` where
  applicable. Cross-origin assets must permit canvas capture.
- Use `setCommentMode(active)` to pause animation when needed, preserving the
  chart's prior state. Do not add your own annotation gesture handlers.
- Return `null` from `getMarks()` or omit the adapter when membership cannot be
  provided reliably; capture then retains an image region. Return `[]` for a
  view with no selectable marks. Do not invent keys for unknown data.
- Keep functions, DOM nodes and geometry out of `values`. The library and server
  create the saved references and image records; do not rebuild them from current data.

Use the closest complete fixture rather than inventing a new integration pattern:

| Case | Fixture and adapter wiring |
|---|---|
| SVG bars | [SimpleBar](fixture/src/fixture/charts/SimpleBar.tsx), [useSvgChart](fixture/src/fixture/charts/chart-bindings.tsx) |
| Lines and pie slices | [SimpleLine](fixture/src/fixture/charts/SimpleLine.tsx), [SimplePie](fixture/src/fixture/charts/SimplePie.tsx), [Nivo bindings](fixture/src/fixture/charts/chart-bindings.tsx) |
| Scatter and binned data | [SimpleScatter](fixture/src/fixture/charts/SimpleScatter.tsx), `VegaDensity` in [advanced examples](fixture/src/fixture/charts/ChartExamples.tsx) |
| Force graph and Sankey | [RelationshipGraph](fixture/src/fixture/charts/RelationshipGraph.tsx) |
| Treemap, dense Canvas, WebGL | `Structures`, `DenseLines`, `Spatial` in [advanced examples](fixture/src/fixture/charts/ChartExamples.tsx) |
| Image without membership | [ImageOnlyExample](fixture/src/fixture/charts/ImageOnlyExample.tsx) |

The reusable renderer helpers are in [chart-adapters.ts](fixture/src/chart-adapters.ts).
The fixture's [React bindings](fixture/src/fixture/charts/chart-bindings.tsx) show
lifecycle wiring; chart libraries themselves remain dependencies of your app.

## 6. Run and publish in PromptQL

Build your SPA and run the reference server as a persistent service under the
same Unix account as the bot. Its owner-only Unix socket must be accessible to
the bot's CLI. Pass these settings to the service explicitly:

| Setting | Value |
|---|---|
| `PROMPTQL_PLATFORM_API_URL`, `PROMPTQL_THREAD_ID` | Values supplied by the PromptQL environment |
| `PORT` | The app's listening port, e.g. `5190` |
| `ANNO_DIST` | Absolute path to the SPA's built output |
| `ANNO_DATA` | Persistent directory for `state.db`; keep it across rebuilds |
| `ANNO_SOCK` | Socket path inside that directory, e.g. `/path/to/state/anno.sock` |
| `BOT_NAME`, `ANNO_APP_TITLE` | Bot name and app title used for comments/messages |
| `PROMPTQL_TIMEZONE` | Reviewers' time zone, or `UTC` |
| `BUILD_ID` | A fresh value for each deployment, such as a timestamp |

Start `node /path/to/live-commenting/fixture/server.mjs` with those settings using
the VM's process supervisor. Do not put the publisher JWT in its environment
file. If serving through your own backend, proxy the comment API routes listed
in §2. Publish that backend's port as the AppArtifact entry point, and have its
readiness endpoint check the services the app needs.

```sh
curl --fail http://127.0.0.1:5190/readyz   # expected: HTTP 204
```

Register the running service as an AppArtifact. Set `ARTIFACT_ID` to the app's
stable identifier and `ARTIFACT_TITLE` to its title. Create `app-artifact.json`
with the VM ID from `PROMPTQL_SANDBOX_ID` and the server's port:

```json
{
  "version": 2,
  "host": "vm",
  "sandbox_id": "<PROMPTQL_SANDBOX_ID>",
  "kind": "web",
  "port": 5190,
  "protocol": "http",
  "readiness": { "path": "/readyz" },
  "required_permissions": { "promptql_graphql": "read_write" }
}
```

```sh
curl --fail-with-body --request PUT \
  "$PROMPTQL_PLATFORM_API_URL/v1/artifacts/threads/$PROMPTQL_THREAD_ID/$ARTIFACT_ID" \
  -H "Authorization: Bearer $PROMPTQL_USER_JWT" \
  -H 'X-PromptQL-Artifact-Type: app' \
  -H "X-PromptQL-Artifact-Title: $ARTIFACT_TITLE" \
  -H 'Content-Type: application/json' \
  --data-binary @app-artifact.json
```

Publishing registers the service; it does not start it. Open the published app
and grant its requested access. A direct localhost request has no PromptQL viewer
identity unless it passes through the development harness.

## 7. Configure the bot's access

The server exposes a local Unix socket. Point the CLI at the configured socket:

```sh
export ANNO_SOCK=/path/to/state/anno.sock
node /path/to/live-commenting/fixture/scripts/anno.mjs read
node /path/to/live-commenting/fixture/scripts/anno.mjs snapshot "$SNAPSHOT_ID" /tmp/selection.png
node /path/to/live-commenting/fixture/scripts/anno.mjs reply "$DISCUSSION_ID" 'Reply text'
node /path/to/live-commenting/fixture/scripts/anno.mjs resolve "$DISCUSSION_ID" 'What changed'
node /path/to/live-commenting/fixture/scripts/anno.mjs reopen "$DISCUSSION_ID" 'Why'
```

Take discussion and snapshot IDs from `read`. It returns complete history;
redirect large results to a file and inspect them in pieces. Bot writes support
`--id` for idempotency and `--expected-seq` for a discussion revision guard. Use
the discussion's `last_seq` from `read` for that guard. A sequence conflict means
the discussion changed: read it again before deciding on a new write. Reusing a
write ID is valid only for the same payload; the CLI does not retry automatically.

Install the following in the owning bot's durable instructions, replacing the
CLI/socket paths with actual absolute paths. A file in the app repository does
not automatically install instructions into the bot's context.

> At the start of each interaction, read the app's comment history using its
> configured `anno.mjs read` command. Act on a current bot-directed comment
> receipt or an explicit chat request, not on old requests discovered in history.
> Inspect the requested discussion's references, original values and recorded
> image before editing its subject. Keep annotation IDs and data identities when
> revising the artifact. Reply, resolve or reopen the requested discussions through
> the CLI. Ask for clarification in a reply when needed; resolve after completing
> the requested work. Use the current triggering user's permissions. A receipt
> arriving during other work is handled first, then the interrupted work can resume.

## 8. Verify and update

Before handing over the app:

- Open it through PromptQL, confirm viewer identity, post a comment and reload.
- Open a second viewer and verify the comment and a reply are shared.
- Send a bot-directed comment; verify the bot receives it, reads its reference
  and image through the CLI, and replies into the same discussion.
- Check unique target IDs after rerendering. Reorder content and change its wording
  while keeping identities; verify existing references still resolve.
- For charts, exercise a point and a rectangle, then change values, move/remove
  members and restore them. Verify the stored selection and original image remain
  intact. Also test the image-only case and renderer/resize changes where applicable.
- Check the application's normal controls still work outside Comment mode.

When updating, use the browser package, host integration, server and CLI from the
same release. Rebuild the SPA, set a new `BUILD_ID`, and restart the service.
Preserve `ANNO_DATA`, the socket location, annotation IDs and record keys. Never
clear discussion history as part of regenerating the artifact.

For product behavior see [README.md](README.md). For library development and its
isolated test suites see [AGENT.md](AGENT.md).
