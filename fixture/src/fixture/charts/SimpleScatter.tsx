import { useEffect, useRef, useState } from 'react';
import embed from 'vega-embed';
import { anno, annoText } from '../../anno';
import { observationData } from './example-data';

export function SimpleScatter() {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('Click a point to inspect an observation.');
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let view: Awaited<ReturnType<typeof embed>>['view'] | undefined;
    const host = root.current!;
    const spec = {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json', width: 'container', height: 220,
      data: { values: observationData }, mark: { type: 'circle', size: 90, color: '#2563eb', opacity: .8 },
      encoding: {
        x: { field: 'latency', type: 'quantitative', title: 'Latency (ms)', scale: { domain: [0, 200] } },
        y: { field: 'utilization', type: 'quantitative', title: 'Utilization (%)', scale: { domain: [0, 100] } },
        tooltip: [{ field: 'id' }, { field: 'latency' }, { field: 'utilization' }],
      },
      config: { font: 'system-ui', axis: { gridColor: '#e2e8f0', tickCount: 5 }, view: { stroke: null } },
    };
    const resize = new ResizeObserver(() => { if (view) void view.resize().runAsync(); });
    embed(host, spec as Parameters<typeof embed>[1], { renderer: 'svg', actions: false }).then(result => {
      view = result.view;
      if (disposed) { view.finalize(); return; }
      view.addEventListener('click', (_, item) => {
        const d = item?.datum;
        if (d?.id) setSelected(`${d.id} · ${d.latency} ms · ${d.utilization}% utilization`);
      });
      resize.observe(host);
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; resize.disconnect(); view?.finalize(); };
  }, []);
  return <article {...anno('charts.basic.scatter', 'Latency and utilization')} className="recipe" data-basic="scatter">
    <h3 {...annoText('charts.basic.scatter.heading', 'Latency and utilization')}>Twenty-four observations</h3>
    <p className="recipe-caption">Each observation has its own key. Latency and utilization may both change.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div {...anno('charts.basic.scatter.plot', 'Latency and utilization', { semantic: { kind: 'chart', xUnits: 'ms', yUnits: '%' } })}
      ref={root} className="simple-vega" role="img" aria-label="Latency and utilization for 24 observations" />
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
