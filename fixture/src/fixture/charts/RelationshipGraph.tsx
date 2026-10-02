import { registerChart } from '../../chart';
import { echartsMarks, captureECharts } from '../../chart-adapters';
import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { GraphChart, SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { anno, annoText } from '../../anno';
import { graphNodes, graphLinks } from './example-data';

echarts.use([GraphChart, SankeyChart, TooltipComponent, CanvasRenderer, SVGRenderer]);
const nodeName = (id: string) => graphNodes.find(n => n.id === id)?.label ?? id;

export function RelationshipGraph() {
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<'Force' | 'Sankey'>('Force');
  const [renderer, setRenderer] = useState<'svg' | 'canvas'>('svg');
  const [selected, setSelected] = useState('Click a node or link. Drag nodes with Comment mode off.');
  useEffect(() => {
    const chart = echarts.init(root.current!, undefined, { renderer });
    const nodes = graphNodes.map(n => ({ id: n.id, name: n.id, value: 1 }));
    const links = graphLinks.map(e => ({ ...e }));
    chart.setOption({
      animation: false, color: ['#2563eb', '#0d9488', '#d97706', '#9333ea'],
      tooltip: { confine: true, formatter: (p: any) => p.dataType === 'edge'
        ? `${nodeName(p.data.source)} → ${nodeName(p.data.target)}: ${p.data.value}` : nodeName(p.name) },
      series: [{
        id: 'service-flow', type: layout === 'Force' ? 'graph' : 'sankey',
        data: nodes, links, draggable: true,
        label: { show: true, position: 'right', fontSize: 12, formatter: (p: any) => nodeName(p.name) },
        ...(layout === 'Force' ? {
          layout: 'force', roam: true, symbolSize: 32,
          force: { repulsion: 320, edgeLength: [75, 125], gravity: .12, layoutAnimation: false },
          lineStyle: { color: '#94a3b8', width: 3, curveness: .12 }, emphasis: { focus: 'adjacency' },
        } : {
          left: 10, right: 80, top: 20, bottom: 20, nodeWidth: 20, nodeGap: 30,
          lineStyle: { color: 'gradient', opacity: .3, curveness: .5 }, emphasis: { focus: 'adjacency' },
        }),
      }],
    });
    chart.on('click', (p: any) => setSelected(p.dataType === 'edge'
      ? `${nodeName(p.data.source)} → ${nodeName(p.data.target)} · ${p.data.value} requests · ${p.data.id}`
      : `${nodeName(p.data.id)} · node ${p.data.id}`));
    const bridge=registerChart(root.current!,{version:1,capture:()=>captureECharts(chart,root.current!),getMarks:()=>echartsMarks(chart,({data,dataType})=>dataType==='edge'
      ?{key:`edge/${data.id}`,label:`${nodeName(data.source)} → ${nodeName(data.target)}`,kind:'link',values:{requests:data.value,source:data.source,target:data.target}}
      :{key:`node/${data.id}`,label:nodeName(data.id),kind:'node'})});
    chart.on('rendered',bridge.changed);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(root.current!);
    return () => { resize.disconnect(); chart.off('rendered',bridge.changed);bridge.dispose();chart.dispose(); };
  }, [layout, renderer]);
  return <article {...anno('charts.basic.network', 'Service request flow')} className="recipe" data-basic="network">
    <h3 {...annoText('charts.basic.network.heading', 'Service request flow')}>Eight services, ten connections</h3>
    <p className="recipe-caption">Two layouts of the same relationships. Stable node and link keys survive movement; crossing links exercise rectangle boundaries.</p>
    <div className="toolbar">
      <div className="choice"><span>Layout</span><div role="group" aria-label="Simple graph layout">{(['Force', 'Sankey'] as const).map(v => <button key={v}
        {...anno(`charts.basic.network.layout.${v.toLowerCase()}`, `${v} layout`)} aria-pressed={layout === v} onClick={() => setLayout(v)}>{v}</button>)}</div></div>
      <div className="choice"><span>Renderer</span><div role="group" aria-label="Simple graph renderer">{(['svg', 'canvas'] as const).map(v => <button key={v}
        {...anno(`charts.basic.network.renderer.${v}`, `${v.toUpperCase()} renderer`)} aria-pressed={renderer === v} onClick={() => setRenderer(v)}>{v.toUpperCase()}</button>)}</div></div>
    </div>
    <div {...anno('charts.basic.network.plot', 'Service request flow', { mode:'chart', semantic: { kind: 'chart', dataset: 'service-flow', units: 'requests' } })}
      className="plot relationship-plot" ref={root} data-layout={layout.toLowerCase()} data-renderer={renderer} role="img" aria-label={`${layout} graph of eight services and ten connections`} />
    <p className="recipe-status" role="status">{selected}</p>
  </article>;
}
