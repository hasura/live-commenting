import { useNivoLineChart } from './chart-bindings';
import { useState } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { anno, annoText } from '../../anno';
import { dailyData, dailyLabel, dayLabel } from './example-data';

// A real SVG label, separate from the observations. Whole-label comments only.
const MetricLabel=({innerWidth}:{innerWidth:number})=><text
  {...anno('charts.basic.line.label.metric','Requests metric label',{semantic:{chartId:'charts.basic.line.plot',role:'label',seriesKey:'requests'}})}
  x={innerWidth} y={-5} textAnchor="end" fontSize={10} fill="#64748b" pointerEvents="all">Requests per day</text>;

export function SimpleLine() {
  const chart=useNivoLineChart({left:38,top:16},p=>({key:JSON.stringify([p.seriesId,p.data.x]),label:dailyLabel(String(p.data.x)),kind:'point',values:{date:String(p.data.x),requests:p.data.y}}));
  const [selected, setSelected] = useState('Click an observation to inspect its date and value.');
  return <article {...anno('charts.basic.line', 'Daily requests')} className="recipe" data-basic="line">
    <h3 {...annoText('charts.basic.line.heading', 'Daily requests', {chartId:'charts.basic.line.plot',role:'title'})}>Twelve daily observations</h3>
    <p {...annoText('charts.basic.line.subtitle', 'Daily requests subtitle', {chartId:'charts.basic.line.plot',role:'subtitle'})} className="recipe-caption">One series with visible points. The date identifies an observation within the Requests series.</p>
    <div {...anno('charts.basic.line.plot', 'Daily requests', { mode:'chart', semantic: { kind: 'chart', series: 'requests', units: 'requests', grain: 'calendar-day' } })}
      ref={chart.ref} className="plot simple-plot" role="img" aria-label="Daily requests for September 1 through 12, 2026">
      <ResponsiveLine data={[{ id: 'requests', data: dailyData.map(d => ({ x: d.date, y: d.requests })) }]}
        margin={{ top: 16, right: 20, bottom: 42, left: 38 }} xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 0, max: 100 }}
        layers={['grid','axes','lines','points',chart.layer,'mesh','legends',MetricLabel]} colors={['#0d9488']} pointSize={8} pointBorderWidth={2} pointBorderColor="#fff" enableGridX={false} animate={false} useMesh
        axisBottom={{ tickValues: dailyData.filter((_, i) => i % 3 === 0 || i === 11).map(d => d.date), format: dayLabel }}
        axisLeft={{ tickValues: 5 }}
        onClick={p => { if ('data' in p) setSelected(`${dailyLabel(String(p.data.x))} · ${p.data.y} requests`); }} />
    </div>
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
