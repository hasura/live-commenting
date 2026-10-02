import { clipPathFor } from './layout';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ChartRef, Ref, TargetLayout } from './types';
import { paintGeometry, resolveChart, sameValues } from './chart';

export function ChartHighlight({reference,layout}:{reference:ChartRef;layout:TargetLayout}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{
    const el=canvas.current;if(!el||layout.hidden)return;
    const ratio=Math.min(devicePixelRatio||1,2),{width,height}=layout.box;
    el.width=Math.max(1,Math.ceil(width*ratio));el.height=Math.max(1,Math.ceil(height*ratio));
    const ctx=el.getContext('2d')!;ctx.scale(ratio,ratio);
    ctx.strokeStyle='#1d4ed8';ctx.fillStyle='rgba(37,99,235,.18)';ctx.lineWidth=3;
    for(const m of resolveChart(reference,layout).marks){
      ctx.strokeStyle='#fff';ctx.lineWidth=6;paintGeometry(ctx,m.geometry,false,true);
      ctx.strokeStyle='#1d4ed8';ctx.lineWidth=3;paintGeometry(ctx,m.geometry,true,true);
    }
  },[reference,layout]);
  if(layout.hidden)return null;
  return <canvas ref={canvas} className="ca-chart-members" aria-hidden="true" style={{position:'absolute',...layout.box,clipPath:clipPathFor(layout)}}/>;
}

/** One deterministic, historical description. Current availability is separate. */
export function SelectionDetails({reference,layout}:{reference:Ref;layout?:TargetLayout}) {
  const [dataOpen,setDataOpen]=useState(false),[limit,setLimit]=useState(10);
  if(reference.kind!=='chart'&&!reference.snapshot)return null;
  const snapshot=reference.snapshot;
  const imageUrl=snapshot?.dataUrl?.startsWith('data:image/png;base64,')?snapshot.dataUrl:snapshot?.id&&/^[a-f0-9]{64}$/.test(snapshot.id)?`/api/snapshots/${snapshot.id}`:undefined;
  const chart=reference.kind==='chart'?reference:null;
  const resolved=chart&&layout?resolveChart(chart,layout):null;
  const total=chart?.members?.length;
  const single=total===1;
  const current=new Map(resolved?.marks.map(m=>[m.key,m])??[]);
  const changed=chart?.members?.filter(m=>current.has(m.key)&&(!sameValues(m.values,current.get(m.key)?.values)||m.label!==current.get(m.key)?.label)).length??0;
  const formatValues=(values:Record<string,unknown>)=>Object.entries(values).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):String(v)}`).join(' · ');
  const data=chart?.members&&<>
    {!single&&<p className="ca-selection-status" role="status">{total===0?'Empty region · original image recorded':`${resolved?.available??0} of ${total} selected items visible in this view`}</p>}
    {!single&&changed>0&&<p className="ca-selection-status">{changed} item{changed===1?' has':'s have'} changed since selection</p>}
    <ul>{chart.members.slice(0,limit).map(m=>{const now=current.get(m.key);return <li key={m.key}><strong>{m.label}</strong>{m.values&&<span>{formatValues(m.values)}</span>}{now&&(!sameValues(m.values,now.values)||m.label!==now.label)&&<span>Now: {now.label}{now.values?` · ${formatValues(now.values)}`:''}</span>}{!now&&<span>Not visible in this view</span>}</li>;})}</ul>
    {limit<chart.members.length&&<button type="button" className="ca-btn-ghost" onClick={()=>setLimit(n=>n+10)}>Show more ({limit} of {chart.members.length})</button>}
  </>;
  return <div className="ca-selection-details">
    {snapshot&&imageUrl&&<div className="ca-original-image">
      <a href={imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Open original selection image">
        <img src={imageUrl} width={snapshot.width} height={snapshot.height} alt="Image when selected" />
      </a>
    </div>}
    {chart?.members===null&&<p className="ca-selection-status">Image region · data membership unavailable</p>}
    {single?<div className="ca-selected-data ca-selected-data-single">{data}</div>:chart?.members&&<details className="ca-selected-data" open={dataOpen} onToggle={e=>setDataOpen(e.currentTarget.open)}>
      <summary>{total} data points</summary>
      {dataOpen&&data}
    </details>}
  </div>;
}
