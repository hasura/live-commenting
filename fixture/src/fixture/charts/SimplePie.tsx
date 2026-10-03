import { useNivoPieChart } from './chart-bindings';
import { useState } from 'react';
import { ResponsivePie } from '@nivo/pie';
import { anno, annoText } from '../../anno';
import { categoryData } from './example-data';

export function SimplePie() {
  const chart=useNivoPieChart({left:20,top:20},d=>({key:String(d.id),label:String(d.label),kind:'slice',values:{requests:d.value}}));
  const [selected, setSelected] = useState('Click a slice to inspect its service and value.');
  return <article {...anno('charts.basic.pie', 'Share of requests by service')} className="recipe" data-basic="pie">
    <h3 {...annoText('charts.basic.pie.heading', 'Share of requests by service', {chartId:'charts.basic.pie.plot',role:'title'})}>Five slices</h3>
    <p {...annoText('charts.basic.pie.subtitle', 'Share of requests by service subtitle', {chartId:'charts.basic.pie.plot',role:'subtitle'})} className="recipe-caption">The same service totals as the bar chart, with one category per slice.</p>
    <div {...anno('charts.basic.pie.plot', 'Share of requests by service', { mode:'chart', semantic: { kind: 'chart', series: 'requests', units: 'requests' } })}
      ref={chart.ref} className="plot simple-plot" role="img" aria-label="Request share across five services">
      <ResponsivePie data={categoryData.map(d => ({ id: d.id, label: d.label, value: d.requests, color: d.color }))}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }} colors={{ datum: 'data.color' }}
        layers={['arcs','arcLabels',chart.layer]} enableArcLinkLabels={false} arcLabel={d => String(d.label)} arcLabelsTextColor="#fff"
        arcLabelsSkipAngle={12} borderWidth={2} borderColor="#fff" animate={false}
        onClick={d => setSelected(`${d.label} · ${d.value} requests`)} />
    </div>
    <div {...anno('charts.basic.pie.legend','Service legend',{semantic:{chartId:'charts.basic.pie.plot',role:'legend'}})} className="mini-legend">{categoryData.map(d => <span key={d.id}
      {...anno(`charts.basic.pie.legend.${d.id}`,`${d.label} legend entry`,{semantic:{chartId:'charts.basic.pie.plot',role:'legend-item',categoryKey:d.id,requests:d.requests}})}><i style={{ background: d.color }} />{d.label}</span>)}</div>
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
