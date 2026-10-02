import { useSvgChart } from './chart-bindings';
import { useState } from 'react';
import { BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { anno, annoText } from '../../anno';
import { categoryData } from './example-data';

export function SimpleBar() {
  const chartRef=useSvgChart(()=>categoryData.map(d=>({key:`requests/${d.id}`,label:d.label,kind:'bar',values:{requests:d.requests}})));
  const [selected, setSelected] = useState('Click a bar to inspect its category.');
  return <article {...anno('charts.basic.bar', 'Requests by service')} className="recipe" data-basic="bar">
    <h3 {...annoText('charts.basic.bar.heading', 'Requests by service')}>Five categories</h3>
    <p className="recipe-caption">A basic bar chart. Each category keeps its identity when its value or position changes.</p>
    <div {...anno('charts.basic.bar.plot', 'Requests by service', { mode:'chart', semantic: { kind: 'chart', series: 'requests', units: 'requests' } })}
      ref={chartRef} className="plot simple-plot" role="img" aria-label="Requests for five services">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 550, height: 285 }}>
        <BarChart data={categoryData} margin={{ top: 16, right: 12, bottom: 10, left: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
          <YAxis width={35} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="requests" name="Requests" fill="#2563eb" isAnimationActive={false}
            shape={(props:any)=><rect x={props.x} y={props.y} width={props.width} height={props.height} fill={props.fill} data-anno-mark={`requests/${props.payload.id}`}/>}
            onClick={(_, index) => { const d = categoryData[index]; setSelected(`${d.label} · ${d.requests} requests`); }} />
        </BarChart>
      </ResponsiveContainer>
    </div>
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
