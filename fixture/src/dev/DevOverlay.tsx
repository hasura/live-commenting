import { useEffect, useMemo, useState } from 'react';
import { PLANTED_CASES } from './plantedCases';
import { allTargets } from '../annotations/target';
import { clipPathFor, useLayouts } from '../annotations/layout';
import { bodyText, type AnnotationDoc } from '../annotations';

/**
 * Dev-only inspector for the fixture. NOT the annotation layer — this exists so
 * you can see what the artifact declares, and inspect the annotation document
 * as it changes.
 *
 * It now shares the library's `useLayouts`, which means it inherits the
 * positioning architecture rather than reimplementing it badly: separate
 * document and viewport containers, and clipping to enclosing scroll roots.
 * Both bugs it previously had are gone as a consequence —
 *
 *   - sticky/fixed targets (the header, the sidebar) no longer drift away from
 *     their outlines as the page scrolls (planted case 7)
 *   - outlines for targets scrolled out of the comment panel are clipped to it
 *     instead of being painted over unrelated document text (planted case 6)
 */

const MODE_COLOR: Record<string, string> = {
  block: '#2563eb',
  text: '#059669',
  region: '#c026d3',
};

export function DevOverlay({ doc }: { doc: AnnotationDoc }) {
  const [open, setOpen] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(48);
  useEffect(() => {
    const toolbar = document.querySelector('.ca-toolbar');
    if (!toolbar) return;
    const observer = new ResizeObserver(() => setToolbarHeight(toolbar.getBoundingClientRect().height));
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const [showAll, setShowAll] = useState(false);
  const [flashed, setFlashed] = useState<string[] | null>(null);
  const [tab, setTab] = useState<'cases' | 'doc'>('cases');
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [targets, setTargets] = useState(() => [] as ReturnType<typeof allTargets>);

  useEffect(() => {
    const el = document.getElementById('artifact-root');
    setRoot(el);
    if (!el) return;
    const sync = () => setTargets(allTargets(el));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { subtree: true, childList: true, attributes: true });
    return () => mo.disconnect();
  }, []);

  const wanted = useMemo(() => {
    if (flashed) return targets.filter((t) => flashed.includes(t.id));
    return showAll ? targets : [];
  }, [targets, flashed, showAll]);

  const layouts = useLayouts(root, wanted);
  const boxes = [...layouts.values()];

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of targets) out[t.mode] = (out[t.mode] ?? 0) + 1;
    return out;
  }, [targets]);

  return (
    <>
      {/* Document-coordinate container: page scroll moves it, no per-box work */}
      <div className="dev-layer dev-layer-document" data-anno-ignore="" aria-hidden="true">
        {boxes
          .filter((l) => l.layer === 'document' && !l.hidden)
          .map((l) => (
            <DevBox key={l.target.id} layout={l} />
          ))}
      </div>

      {/* Viewport-coordinate container: sticky/fixed targets and anything
          inside an inner scroll container */}
      <div className="dev-layer dev-layer-viewport" data-anno-ignore="" aria-hidden="true">
        {boxes
          .filter((l) => l.layer === 'viewport' && !l.hidden)
          .map((l) => (
            <DevBox key={l.target.id} layout={l} />
          ))}
      </div>

      <aside className={`dev-panel ${open ? '' : 'dev-panel-closed'}`} style={{bottom: toolbarHeight + 10}} data-anno-ignore="">
        <button className="dev-panel-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▴'} fixture inspector
        </button>

        {open && (
          <div className="dev-panel-body">
            <div className="dev-tabs">
              <button
                className={tab === 'cases' ? 'dev-tab dev-tab-on' : 'dev-tab'}
                onClick={() => setTab('cases')}
              >
                planted cases
              </button>
              <button
                className={tab === 'doc' ? 'dev-tab dev-tab-on' : 'dev-tab'}
                onClick={() => setTab('doc')}
              >
                document ({doc.threads.length})
              </button>
            </div>

            {tab === 'cases' ? (
              <>
                <label className="dev-check">
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => {
                      setShowAll(e.target.checked);
                      setFlashed(null);
                    }}
                  />
                  outline all targets
                </label>

                <div className="dev-legend">
                  {Object.entries(MODE_COLOR).map(([mode, color]) => (
                    <span key={mode} className="dev-legend-item">
                      <i style={{ background: color }} /> {mode} ({counts[mode] ?? 0})
                    </span>
                  ))}
                </div>

                <p className="dev-hint">Hover a case to outline its elements.</p>

                <ol className="dev-cases" onMouseLeave={() => setFlashed(null)}>
                  {PLANTED_CASES.map((c) => (
                    <li
                      key={c.n}
                      className={c.key ? 'dev-case dev-case-key' : 'dev-case'}
                      onMouseEnter={() => {
                        setShowAll(false);
                        setFlashed(c.targets);
                      }}
                    >
                      <b>
                        {c.n}. {c.title}
                        {c.key ? ' ★' : ''}
                      </b>
                      <span>{c.breaks}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <DocInspector doc={doc} />
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function DevBox({ layout }: { layout: ReturnType<typeof useLayouts> extends Map<string, infer L> ? L : never }) {
  const color = MODE_COLOR[layout.target.mode] ?? '#64748b';
  return (
    <div
      className="dev-box"
      data-dev-target={layout.target.id}
      style={{
        top: layout.box.top,
        left: layout.box.left,
        width: layout.box.width,
        height: layout.box.height,
        borderColor: color,
        clipPath: clipPathFor(layout),
      }}
    >
      <span className="dev-box-tag" style={{ background: color }}>
        {layout.target.label}
      </span>
    </div>
  );
}

/**
 * The annotation document, live. Useful for confirming the round-trip contract
 * by eye: nothing here should contain a pixel measurement, a cluster, or a
 * visibility flag — only refs, snapshots and comment bodies. It is folded from
 * the review server's event log; to start over, restart `npm run dev`.
 */
function DocInspector({ doc }: { doc: AnnotationDoc }) {
  const [raw, setRaw] = useState(false);

  return (
    <div className="dev-doc">
      <div className="dev-doc-actions">
        <label className="dev-check">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          raw JSON
        </label>
      </div>

      {raw ? (
        <pre className="dev-json">{JSON.stringify(doc, null, 2)}</pre>
      ) : doc.threads.length === 0 ? (
        <p className="dev-hint">
          No comments yet. Use the toolbar to enter comment mode, then click an element.
        </p>
      ) : (
        <ol className="dev-threads">
          {doc.threads.map((t) => {
            const ref = t.refs.find((r) => r.kind === 'anno_id');
            return (
              <li key={t.id} className="dev-thread">
                <b>{ref?.label ?? ref?.id}</b>
                <code>{ref?.id}</code>
                <span>{bodyText(t.comments[0]?.body ?? [])}</span>
                <em>
                  {t.status}
                  {t.comments.length > 1 ? ` · ${t.comments.length} comments` : ''}
                  {t.pin ? ` · pin ${t.pin.xPct.toFixed(2)},${t.pin.yPct.toFixed(2)}` : ''}
                </em>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
