import { useState } from 'react';
import { ResponsiveLine } from '@nivo/line';
import { anno, annoText } from '../../anno';
import { dailyData, dailyLabel, dayLabel } from './example-data';

export function SimpleLine() {
  const [selected, setSelected] = useState('Click an observation to inspect its date and value.');
  return <article {...anno('charts.basic.line', 'Daily requests')} className="recipe" data-basic="line">
    <h3 {...annoText('charts.basic.line.heading', 'Daily requests')}>Twelve daily observations</h3>
    <p className="recipe-caption">One series with visible points. The date identifies an observation within the Requests series.</p>
    <div {...anno('charts.basic.line.plot', 'Daily requests', { semantic: { kind: 'chart', series: 'requests', units: 'requests', grain: 'calendar-day' } })}
      className="plot simple-plot" role="img" aria-label="Daily requests for September 1 through 12, 2026">
      <ResponsiveLine data={[{ id: 'requests', data: dailyData.map(d => ({ x: d.date, y: d.requests })) }]}
        margin={{ top: 16, right: 20, bottom: 42, left: 38 }} xScale={{ type: 'point' }} yScale={{ type: 'linear', min: 0, max: 100 }}
        colors={['#0d9488']} pointSize={8} pointBorderWidth={2} pointBorderColor="#fff" enableGridX={false} animate={false} useMesh
        axisBottom={{ tickValues: dailyData.filter((_, i) => i % 3 === 0 || i === 11).map(d => d.date), format: dayLabel }}
        axisLeft={{ tickValues: 5 }}
        onClick={p => { if ('data' in p) setSelected(`${dailyLabel(String(p.data.x))} · ${p.data.y} requests`); }} />
    </div>
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
