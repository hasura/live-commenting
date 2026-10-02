import { useState } from 'react';
import { ResponsivePie } from '@nivo/pie';
import { anno, annoText } from '../../anno';
import { categoryData } from './example-data';

export function SimplePie() {
  const [selected, setSelected] = useState('Click a slice to inspect its service and value.');
  return <article {...anno('charts.basic.pie', 'Share of requests by service')} className="recipe" data-basic="pie">
    <h3 {...annoText('charts.basic.pie.heading', 'Share of requests by service')}>Five slices</h3>
    <p className="recipe-caption">The same service totals as the bar chart, with one category per slice.</p>
    <div {...anno('charts.basic.pie.plot', 'Share of requests by service', { semantic: { kind: 'chart', series: 'requests', units: 'requests' } })}
      className="plot simple-plot" role="img" aria-label="Request share across five services">
      <ResponsivePie data={categoryData.map(d => ({ id: d.id, label: d.label, value: d.requests, color: d.color }))}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }} colors={{ datum: 'data.color' }}
        enableArcLinkLabels={false} arcLabel={d => String(d.label)} arcLabelsTextColor="#fff"
        arcLabelsSkipAngle={12} borderWidth={2} borderColor="#fff" animate={false}
        onClick={d => setSelected(`${d.label} · ${d.value} requests`)} />
    </div>
    <div className="mini-legend">{categoryData.map(d => <span key={d.id}><i style={{ background: d.color }} />{d.label}</span>)}</div>
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
