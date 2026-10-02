import { useSvgChart, useNivoLineChart, useNivoPieChart } from './chart-bindings';
import { registerChart, pointGeometry, type ChartMember, type ChartMark } from '../../chart';
import { echartsMarks, vegaMarks, captureECharts, captureVega } from '../../chart-adapters';
import React, { useState, useMemo, useEffect, useRef, createContext, useContext } from 'react';
import { anno, annoText, annoRegion } from '../../anno';
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, Brush
} from 'recharts';
import { ResponsiveLine, ResponsiveLineCanvas } from '@nivo/line';
import { ResponsivePie } from '@nivo/pie';
import embed from 'vega-embed';
import * as echarts from 'echarts/core';
import { SankeyChart, TreemapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toPng } from 'html-to-image';
import raster from './raster.json';
import { SimpleBar } from './SimpleBar';
import { SimpleLine } from './SimpleLine';
import { SimplePie } from './SimplePie';
import { SimpleScatter } from './SimpleScatter';
import { RelationshipGraph } from './RelationshipGraph';
import { ImageOnlyExample } from './ImageOnlyExample';
import './charts.css';

echarts.use([SankeyChart, TreemapChart, TooltipComponent, CanvasRenderer, SVGRenderer]);

const colors=['#2563eb','#0d9488','#d97706','#9333ea','#e11d48','#0284c7','#65a30d','#c2410c','#6d28d9','#0891b2','#be123c','#4f46e5'];
const fmt=(n:number)=>n.toLocaleString('en-US');
const short=(n:number)=>Math.abs(n)>=1000?`${(n/1000).toFixed(n>=10000?0:1)}k`:`${Math.round(n)}`;
function rng(seed:number){return ()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
function download(uri:string,name:string){const a=document.createElement('a');a.href=uri;a.download=name;document.body.appendChild(a);a.click();a.remove();}
function downloadJSON(value:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));download(url,name);setTimeout(()=>URL.revokeObjectURL(url),5000);}
function useWidth(ref:React.RefObject<HTMLElement|null>){const [w,setW]=useState(600);useEffect(()=>{if(!ref.current)return;const ro=new ResizeObserver(([e])=>setW(Math.max(200,Math.floor(e.contentRect.width))));ro.observe(ref.current);return ()=>ro.disconnect();},[]);return w;}
function Choices({label,value,options,onChange}:{label:string,value:string,options:string[],onChange:(s:string)=>void}){const target=useTarget();return <div className="choice"><span>{label}</span><div role="group" aria-label={label}>{options.map(s=><button key={s} {...target(`control.${slug(label)}.${slug(s)}`,`${label}: ${s}`)} aria-pressed={value===s} onClick={()=>onChange(s)}>{s}</button>)}</div></div>;}
function SaveAsImage({id,children}:{id:string,children:React.ReactNode}){
 const target=useTarget();
 const ref=useRef<HTMLDivElement>(null),[message,setMessage]=useState(''),[menu,setMenu]=useState(false);
 const save=async()=>{setMenu(false);setMessage('Preparing PNG…');try{if(!ref.current)return;const uri=await toPng(ref.current,{backgroundColor:'#ffffff',pixelRatio:2,skipFonts:true,filter:(node)=>!(node instanceof HTMLElement && node.dataset.noExport==='true')});download(uri,`${id}.png`);setMessage('PNG downloaded');}catch(e){setMessage(`Export unavailable: ${String(e)}`);} };
 return <div className="export-shell" onContextMenu={e=>{e.preventDefault();setMenu(true);}}>
  <div className="export-row" data-no-export="true"><span role="status">{message}</span><button {...target("export", "Save chart as PNG")} onClick={save}>Save PNG</button>{menu&&<div role="menu" data-anno-ignore=""><button role="menuitem" onClick={save}>Download chart PNG</button><button onClick={()=>setMenu(false)}>Cancel</button></div>}</div>
  <div ref={ref} className="export-target" data-export-target={id}>{children}</div>
 </div>;
}
// Context supplies identity only; generated charts never import the annotation runtime.
const ChartId = createContext('charts');
const slug = (value:string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
function useTarget() {
 const prefix = useContext(ChartId);
 return (key:string,label:string) => anno(`${prefix}.${key}`,label);
}

class Boundary extends React.Component<{children:React.ReactNode},{error:string}>{
 override state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}
 override render(){return this.state.error?<div className="error" role="alert">Fixture error: {this.state.error}</div>:this.props.children;}
}
function Fixture({id,title,sub,library,children}:{id:string,title:string,sub:string,library:string,children:React.ReactNode}){
 return <ChartId.Provider value={`charts.${id}`}><section {...anno(`charts.${id}`,title,{semantic:{kind:"chart-example",library,synthetic:true}})} id={`fixture-${id}`} className="fixture" data-fixture={id} data-library={library}>
 <header className="fixture-head"><span className="fixture-index">{id}</span><div><h2 {...annoText(`charts.${id}.heading`,title)}>{title}</h2><p>{sub}</p></div></header>
 <div className="provenance"><code>{library}</code></div>
 <Boundary>{children}</Boundary>
 </section></ChartId.Provider>;
}
function Ledger({children}:{children:React.ReactNode}){return <div className="ledger">{children}</div>;}
function Status({value}:{value:string}){return <div className="event" aria-live="polite"><strong>Last interaction</strong><span>{value||'Nothing selected yet. Hover, click or change a control.'}</span></div>;}

const makeMixed=()=>{const r=rng(401);return Array.from({length:120},(_,i)=>{const alpha=Math.round(850+200*Math.sin(i/7)+r()*200),beta=Math.round(550+100*Math.cos(i/9)+r()*140),gamma=Math.round(270+r()*150),total=alpha+beta+gamma;return {day:i+1,label:`Day ${i+1}`,alpha,beta,gamma,total,trend:Math.round(1890+190*Math.sin((i-4)/10)),band:[1450+160*Math.sin(i/10),2350+160*Math.sin(i/10)],rate:i>=58&&i<=61?null:+(2.2+Math.sin(i/8)+r()*.7).toFixed(2)};});};
function Mixed(){
 const data=useMemo(makeMixed,[]),[windowed,setWindowed]=useState(false),[event,setEvent]=useState(''),[hide,setHide]=useState(false);
 const shown=windowed?data.slice(60):data;
 const chartRef=useSvgChart(()=>data.flatMap(d=>['alpha','beta','gamma','trend','rate'].flatMap(series=>{
  const value=d[series as 'alpha'|'beta'|'gamma'|'trend'|'rate'];
  return value==null?[]:[{key:JSON.stringify([series,d.day]),label:`${series} · Day ${d.day}`,kind:series==='trend'||series==='rate'?'point':'bar',values:{day:d.day,value,units:series==='rate'?'%':'requests'}} satisfies ChartMember];
 })));
 return <>
 <div className="toolbar"><Choices label="Window" value={windowed?'Last 60 days':'All 120 days'} options={['All 120 days','Last 60 days']} onChange={v=>setWindowed(v==='Last 60 days')}/><label><input {...anno("charts.A.control.gamma","Hide Gamma stack")} type="checkbox" checked={hide} onChange={e=>setHide(e.target.checked)}/> Hide Gamma stack</label></div>
 <Ledger><span><b>{fmt(shown.length*3)}</b> stacked values</span><span><b>2</b> overlaid lines</span><span><b>2</b> Y axes + uncertainty band</span><span><b>4-day</b> rate gap</span></Ledger>
 <SaveAsImage id="mixed-svg"><div {...anno("charts.A.plot","Mixed Cartesian chart",{mode:"chart",semantic:{kind:"chart",synthetic:true}})} ref={chartRef} className="plot mixed" data-renderer="svg" role="img" aria-label="Requests stacked by service, trend and error rate, with a forecast band">
 <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{width:600,height:455}}>
 <ComposedChart data={shown} margin={{top:22,right:18,left:2,bottom:10}} onClick={(s:any)=>{if(s?.activeLabel)setEvent(`Selected day ${s.activeLabel}`);}}>
 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
 <XAxis dataKey="day" minTickGap={40} tickFormatter={v=>`D${v}`} tick={{fontSize:11}}/>
 <YAxis yAxisId="left" domain={[0,3200]} tickFormatter={short} width={46} tick={{fontSize:11}} label={{value:'requests',position:'insideTopLeft',dy:-17,dx:10,fontSize:11}}/>
 <YAxis yAxisId="right" orientation="right" domain={[0,6]} tickFormatter={v=>`${v}%`} width={38} tick={{fontSize:11}}/>
 <ReferenceArea yAxisId="left" x1={95} x2={120} fill="#f1f5f9" fillOpacity={.7} label={{value:'forecast window',fontSize:10,position:'insideTop'}}/>
 <Area yAxisId="left" type="monotone" dataKey="band" name="Range" fill="#bfdbfe" fillOpacity={.45} stroke="none" isAnimationActive={false}/>
 <Bar yAxisId="left" dataKey="alpha" shape={(p:any)=><rect x={p.x} y={p.y} width={p.width} height={p.height} fill={p.fill} data-anno-mark={JSON.stringify(['alpha',p.payload.day])}/>} name="Alpha" stackId="requests" fill={colors[0]} isAnimationActive={false}/>
 <Bar yAxisId="left" dataKey="beta" shape={(p:any)=><rect x={p.x} y={p.y} width={p.width} height={p.height} fill={p.fill} data-anno-mark={JSON.stringify(['beta',p.payload.day])}/>} name="Beta" stackId="requests" fill={colors[1]} isAnimationActive={false}/>
 {!hide&&<Bar yAxisId="left" dataKey="gamma" shape={(p:any)=><rect x={p.x} y={p.y} width={p.width} height={p.height} fill={p.fill} data-anno-mark={JSON.stringify(['gamma',p.payload.day])}/>} name="Gamma" stackId="requests" fill={colors[2]} isAnimationActive={false}/>}
 <Line yAxisId="left" dataKey="trend" name="7-day trend" stroke="#0f172a" strokeWidth={2.2} dot={(p:any)=><circle cx={p.cx} cy={p.cy} r={.5} opacity={0} data-anno-mark={JSON.stringify(['trend',p.payload.day])}/>} isAnimationActive={false}/>
 <Line yAxisId="right" dataKey="rate" name="Error rate (%)" stroke="#be123c" strokeWidth={2} strokeDasharray="5 3" dot={(p:any)=>p.payload.rate==null?<g/>:<circle cx={p.cx} cy={p.cy} r={.5} opacity={0} data-anno-mark={JSON.stringify(['rate',p.payload.day])}/>} connectNulls={false} isAnimationActive={false}/>
 <ReferenceLine yAxisId="right" y={4} stroke="#be123c" strokeDasharray="2 5" label={{value:'4% alert',fontSize:10,position:'insideTopRight'}}/>
 <Tooltip wrapperStyle={{maxWidth:240,fontSize:11}} allowEscapeViewBox={{x:false,y:false}} labelFormatter={v=>`Day ${v}`} formatter={(v:any,n:any)=>[Array.isArray(v)?v.map((x:number)=>Math.round(x)).join(' – '):v,n]}/>
 <Legend wrapperStyle={{fontSize:11}}/>
 <Brush dataKey="day" height={24} stroke="#64748b" travellerWidth={10} tickFormatter={v=>`D${v}`} onChange={(v:any)=>setEvent(`Brush indices ${v?.startIndex}–${v?.endIndex}`)}/>
 </ComposedChart>
 </ResponsiveContainer>
 </div></SaveAsImage>
 <div className="notes">Try: dense SVG rectangles, overlapping paths, dual scales, brush handles, reference lines, tooltips and click targets. Dashed red line breaks on days 59–62; the shaded window is synthetic forecasting context.</div>
 <Status value={event}/>
 </>;
}

function makeLines(n:number){const r=rng(820);return Array.from({length:8},(_,s)=>({id:`Series ${s+1}`,color:colors[s],data:Array.from({length:n},(_,i)=>({x:i,y:i>n*.45&&i<n*.49&&s%3===0?null:+(14+s*8+8*Math.sin(i/(n/16)+s)+5*Math.cos(i/(n/37))+r()*5+(i>n*.72&&i<n*.77?13:0)).toFixed(2)}))}));}
function DenseLines({stress}:{stress:boolean}){
 const chart=useNivoLineChart({left:48,top:30},p=>({key:JSON.stringify([p.seriesId,p.data.x]),label:`${p.seriesId} · sample ${p.data.x}`,kind:'point',values:{sample:p.data.x,signal:p.data.y}}));
 const [renderer,setRenderer]=useState('SVG'),[event,setEvent]=useState('');const n=stress?3000:750;
 const data=useMemo(()=>makeLines(n),[n]); const valid=data.reduce((s,v)=>s+v.data.filter(p=>p.y!==null).length,0);
 const common:any={data,colors:{datum:'color'},margin:{top:30,right:24,bottom:52,left:48},xScale:{type:'linear',min:0,max:n-1},yScale:{type:'linear',min:0,max:115},curve:'linear',enablePoints:false,enableGridX:false,enableGridY:true,axisBottom:{tickValues:5,legend:'sample index',legendOffset:38,legendPosition:'middle'},axisLeft:{tickValues:5,legend:'signal (a.u.)',legendOffset:-38,legendPosition:'middle'},theme:{text:{fontSize:11,fill:'#475569'},grid:{line:{stroke:'#e2e8f0'}},tooltip:{container:{background:'white',color:'#172033',fontSize:11,maxWidth:230}}},lineWidth:1.5,animate:false,markers:[{axis:'y',value:90,lineStyle:{stroke:'#be123c',strokeWidth:1,strokeDasharray:'4 4'},legend:'threshold 90',legendPosition:'top-left'}],onClick:(p:any)=>setEvent(`${p.seriesId||p.serieId||''} · sample ${p.data?.xFormatted??p.data?.x} = ${p.data?.yFormatted??p.data?.y}`)};
 return <>
 <div className="toolbar"><Choices label="Line renderer" value={renderer} options={['SVG','Canvas']} onChange={setRenderer}/><span className="hint">Same data. Different hit-testing surface.</span></div>
 <Ledger><span><b>8</b> series</span><span><b>{fmt(n*8)}</b> sample slots</span><span><b>{fmt(valid)}</b> non-null values</span><span><b>3</b> interrupted series</span></Ledger>
 <SaveAsImage id={`dense-lines-${renderer.toLowerCase()}`}><div {...anno("charts.B.plot","Dense time-series chart",{mode:"chart",semantic:{kind:"chart",synthetic:true}})} ref={chart.ref} className="plot" data-renderer={renderer.toLowerCase()} role="img" aria-label={`Eight dense time series rendered with Nivo ${renderer}`}>
 {renderer==='SVG'?<ResponsiveLine {...common} layers={['grid','markers','axes','lines','points',chart.layer,'mesh','legends']} useMesh enableSlices={false} enableCrosshair enablePointLabel={false}/>:<ResponsiveLineCanvas {...common} pixelRatio={Math.min(window.devicePixelRatio||1,2)} layers={['grid','axes','lines',(ctx:any,{yScale,innerWidth}:any)=>{ctx.save();ctx.strokeStyle='#be123c';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,yScale(90));ctx.lineTo(innerWidth,yScale(90));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#475569';ctx.font='11px system-ui';ctx.fillText('threshold 90',4,yScale(90)-6);ctx.restore();},'points','mesh','legends',chart.canvasLayer]}/>}
 </div></SaveAsImage>
 <div className="mini-legend">{data.map(d=><span key={d.id}><i style={{background:d.color}}/>{d.id}</span>)}</div>
 <div className="notes">SVG: thousands of coordinates in line paths, not thousands of circle nodes. Canvas: pixels with nearest-point interaction. Gaps remain missing, never zero. Stress mode: 24,000 sample slots.</div>
 <Status value={event}/>
 </>;
}

function Composition(){
 const chart=useNivoPieChart({left:50,top:32},d=>({key:String(d.id),label:String(d.label),kind:'slice',values:{value:d.value,total:raster.total,share:100*d.value/raster.total}}));
 const [mode,setMode]=useState('Donut / SVG'),[event,setEvent]=useState(''),[selected,setSelected]=useState('');
 const vals=raster.values;const total=raster.total;
 const center=({centerX,centerY}:any)=><g transform={`translate(${centerX},${centerY})`} pointerEvents="none"><text textAnchor="middle" y={-4} fontSize={26} fontWeight={700} fill="#172033">{fmt(total)}</text><text textAnchor="middle" y={19} fontSize={11} fill="#64748b">synthetic total</text></g>;
 return <>
 <div className="toolbar"><Choices label="Composition mode" value={mode} options={['Donut / SVG','Pie / SVG','ReportLab / PNG']} onChange={setMode}/></div>
 <Ledger><span><b>18</b> unequal slices</span><span><b>{fmt(total)}</b> total</span><span><b>{mode.includes('PNG')?'Raster image':'SVG paths'}</b> active surface</span></Ledger>
 <SaveAsImage id={mode.includes('PNG')?'composition-raster':'composition-svg'}>
 <div {...anno("charts.C.plot","Composition chart",{mode:"chart",semantic:{kind:"chart",synthetic:true}})} ref={chart.ref} className={mode.includes('PNG')?'raster-plot':'plot pie-plot'} data-renderer={mode.includes('PNG')?'raster':'svg'} role="img" aria-label="Category composition with 18 unequal segments">
 {mode.includes('PNG')?<img {...annoRegion("charts.C.raster","ReportLab composition image",{kind:"image",synthetic:true,membership:"unavailable"})} src="/chart-composition.png" alt="ReportLab raster pie with 18 numbered segments, their values represented in the adjacent accessible legend." data-chart-image="composition"/>:
 <ResponsivePie data={vals} margin={{top:32,right:50,bottom:30,left:50}} innerRadius={mode.startsWith('Donut')?.61:0} padAngle={.65} cornerRadius={2} activeOuterRadiusOffset={7} colors={{datum:'data.color'}} borderWidth={1} borderColor="#ffffff" arcLinkLabelsSkipAngle={16} arcLinkLabel={d=>String(d.id).replace('Segment ','#')} arcLinkLabelsTextColor="#475569" arcLabelsSkipAngle={15} arcLabel={d=>`${(d.value/total*100).toFixed(0)}%`} arcLabelsTextColor="#ffffff" animate={false} layers={mode.startsWith('Donut')?['arcs','arcLinkLabels','arcLabels',center,chart.layer]:['arcs','arcLinkLabels','arcLabels',chart.layer]} onClick={d=>{setSelected(String(d.id));setEvent(`${d.id}: ${fmt(d.value)} · ${(100*d.value/total).toFixed(2)}%`);}} theme={{text:{fontSize:11},tooltip:{container:{color:'#172033',fontSize:12}}}}/>}
 </div>
 </SaveAsImage>
 <div className="slice-list">{vals.map(v=><button key={v.id} {...anno(`charts.C.legend.${slug(v.id)}`,`${v.id}: ${v.value}`)} aria-pressed={selected===v.id} onClick={()=>{setSelected(v.id);setEvent(`${v.id}: ${fmt(v.value)} · ${(100*v.value/total).toFixed(2)}%`);}}><i style={{background:v.color}}/><span>{v.id}</span><b>{fmt(v.value)}</b><small>{(v.value/total*100).toFixed(1)}%</small></button>)}</div>
 <div className="notes">Try: radial paths, narrow slices, label collisions, center text and linked legend selection. PNG mode is a genuine pre-rendered ReportLab image: no per-slice DOM or native hover. Legend buttons still work.</div>
 <Status value={event}/>
 </>;
}

function makeCloud(n:number){const r=rng(8192);return Array.from({length:n},(_,i)=>{const group=i%4;const x=Math.max(1,Math.min(199,35+group*37+(r()+r()+r()-1.5)*52));const y=Math.max(1,Math.min(99,18+group*17+Math.sin(x/19)*8+(r()+r()-1)*20));return {id:i,x:+x.toFixed(2),y:+y.toFixed(2),group:`Cluster ${group+1}`,size:4+r()*14};});}
function VegaDensity({stress}:{stress:boolean}){
 const [mode,setMode]=useState('Scatter'),[renderer,setRenderer]=useState('Canvas'),[event,setEvent]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const ref=useRef<HTMLDivElement>(null);const width=useWidth(ref);const points=useMemo(()=>makeCloud(stress?20000:6000),[stress]);
 useEffect(()=>{let gone=false,view:any,bridge:ReturnType<typeof registerChart>|undefined;setReady(false);setError('');
 const spec:any={$schema:'https://vega.github.io/schema/vega-lite/v6.json',width:Math.max(160,width-72),height:330,autosize:{type:'pad',contains:'padding'},background:'white',data:{values:points},config:{font:'system-ui',axis:{labelFontSize:10,titleFontSize:11,gridColor:'#e2e8f0',labelOverlap:true,tickCount:5},view:{stroke:null},legend:{orient:'bottom',labelFontSize:11,title:null,columns:2,gradientLength:Math.min(220,Math.max(140,width-90))}},params:[{name:'zoom',select:'interval',bind:'scales'},{name:'pick',select:{type:'point',on:'click',clear:'dblclick'}}]};
 if(mode==='Scatter'){spec.mark={type:'circle',opacity:.52};spec.encoding={x:{field:'x',type:'quantitative',title:'Latency (ms)',scale:{domain:[0,200]}},y:{field:'y',type:'quantitative',title:'Utilization (%)',scale:{domain:[0,100]}},color:{field:'group',type:'nominal',scale:{range:colors.slice(0,4)}},size:{field:'size',type:'quantitative',legend:null,scale:{range:[8,60]}},tooltip:[{field:'id'},{field:'group'},{field:'x',format:'.2f'},{field:'y',format:'.2f'}],stroke:{condition:{param:'pick',empty:false,value:'#0f172a'},value:null}};}
 else {spec.transform=[{bin:{step:5,extent:[0,200]},field:'x',as:['x0','x1']},{bin:{step:5,extent:[0,100]},field:'y',as:['y0','y1']},{aggregate:[{op:'count',as:'observations'}],groupby:['x0','x1','y0','y1']}];spec.mark={type:'rect'};spec.encoding={x:{field:'x0',type:'quantitative',bin:'binned',title:'Latency (ms)'},x2:{field:'x1'},y:{field:'y0',type:'quantitative',bin:'binned',title:'Utilization (%)'},y2:{field:'y1'},color:{field:'observations',type:'quantitative',title:'Samples per cell',scale:{scheme:'blues'}},tooltip:[{field:'observations',title:'Samples'},{field:'x0',title:'Latency from'},{field:'x1',title:'Latency to'},{field:'y0',title:'Utilization from'},{field:'y1',title:'Utilization to'}]};}
 embed(ref.current!,spec,{renderer:renderer.toLowerCase() as any,actions:{export:true,source:false,compiled:false,editor:false},tooltip:{id:'chart-examples-tooltip',disableDefaultStyle:true,theme:'custom'}}).then(r=>{view=r.view;if(gone){view.finalize();return;}view.addEventListener('click',(_:any,item:any)=>{if(item?.datum)setEvent(JSON.stringify(item.datum));});
  bridge=registerChart(ref.current!,{version:1,capture:()=>captureVega(view,ref.current!),getMarks:()=>vegaMarks(view,(d,type):ChartMember|null=>{
   if(type==='symbol'&&d?.id!=null)return {key:`observation/${d.id}`,label:`Observation ${d.id} · ${d.group}`,kind:'point',values:{latency:d.x,utilization:d.y,cluster:d.group}};
   if(type==='rect'&&d?.x0!=null)return {key:JSON.stringify(['bin',d.x0,d.x1,d.y0,d.y1]),label:`Latency ${d.x0}–${d.x1} ms · utilization ${d.y0}–${d.y1}%`,kind:'bin',values:{count:d.observations,x0:d.x0,x1:d.x1,y0:d.y0,y1:d.y1}};
   return null;
  })});
  for(const signal of ['width','height','zoom_x','zoom_y'])try{view.addSignalListener(signal,()=>bridge?.changed());}catch{}
  view.addEventListener('pointermove',(e:any)=>{if(e.buttons)requestAnimationFrame(()=>bridge?.changed());});view.addEventListener('wheel',()=>requestAnimationFrame(()=>bridge?.changed()));view.addEventListener('pointerup',()=>requestAnimationFrame(()=>bridge?.changed()));
  setReady(true);}).catch(e=>{if(!gone)setError(String(e));});
 return ()=>{gone=true;bridge?.dispose();view?.finalize();};},[mode,renderer,width,points]);
 return <>
 <div className="toolbar"><Choices label="Density geometry" value={mode} options={['Scatter','Heatmap']} onChange={setMode}/><Choices label="Vega renderer" value={renderer} options={['Canvas','SVG']} onChange={setRenderer}/></div>
 <Ledger><span><b>{fmt(points.length)}</b> input points</span><span><b>{mode==='Scatter'?'4':'40 × 20'}</b> {mode==='Scatter'?'clusters':'possible bins'}</span><span><b>{renderer}</b> active surface</span><span data-ready="vega">{ready?'Ready':'Rendering…'}</span></Ledger>
 {error&&<div className="error">{error}</div>}
 <div {...anno("charts.D.plot","Density chart",{mode:"chart",semantic:{kind:"chart",synthetic:true}})} className="vega-holder" ref={ref} data-renderer={renderer.toLowerCase()} role="img" aria-label={`${mode} with ${points.length} synthetic observations`}/>
 <div className="notes">Try: wheel zoom, drag pan, point/cell click, SVG↔Canvas and the Vega ⋯ export menu. Same raw observations; heatmap bins aggregate them. Double-click clears selection. Stress mode: 20,000 input points.</div>
 <Status value={event}/>
 </>;
}

function makeFlow(){
 const nodes=Array.from({length:4},(_,stage)=>Array.from({length:6},(_,i)=>({name:`${['Source','Queue','Worker','Sink'][stage]} ${i+1}`,depth:stage}))).flat();
 const links=[];for(let stage=0;stage<3;stage++)for(let i=0;i<6;i++)for(let j=0;j<3;j++)links.push({source:nodes[stage*6+i].name,target:nodes[(stage+1)*6+(i+j)%6].name,value:15+((i*13+j*19+stage*7)%60)});
 const tree=Array.from({length:4},(_,a)=>({name:`Region ${a+1}`,children:Array.from({length:4},(_,b)=>({name:`Team ${a+1}.${b+1}`,children:Array.from({length:6},(_,c)=>({name:`Service ${a+1}.${b+1}.${c+1}`,value:10+((a*77+b*31+c*41)%250)}))}))}));
 return {nodes,links,tree};
}
function Structures(){
 const [mode,setMode]=useState('Sankey'),[renderer,setRenderer]=useState('Canvas'),[event,setEvent]=useState(''),[reset,setReset]=useState(0);
 const ref=useRef<HTMLDivElement>(null);const flow=useMemo(makeFlow,[]);
 useEffect(()=>{if(!ref.current)return;const el=ref.current;const chart=echarts.init(el,undefined,{renderer:renderer.toLowerCase() as any});
 const option:any={animation:false,color:colors,textStyle:{fontFamily:'system-ui'},tooltip:{trigger:'item',confine:true,textStyle:{fontSize:11},backgroundColor:'#fff'}};
 option.series=[mode==='Sankey'?{type:'sankey',left:18,right:75,top:20,bottom:20,data:flow.nodes,links:flow.links,nodeWidth:14,nodeGap:20,draggable:true,layoutIterations:32,emphasis:{focus:'adjacency'},lineStyle:{color:'gradient',curveness:.55,opacity:.24},label:{fontSize:10,color:'#334155'}}:{type:'treemap',data:flow.tree,left:5,right:5,top:5,bottom:28,roam:true,nodeClick:'zoomToNode',breadcrumb:{show:true,left:10,bottom:1,itemStyle:{color:'#e2e8f0',textStyle:{color:'#172033'}}},label:{show:true,fontSize:10},upperLabel:{show:true,height:20,color:'#172033'},itemStyle:{borderColor:'#fff',borderWidth:1,gapWidth:2},levels:[{itemStyle:{borderWidth:0,gapWidth:5}},{colorSaturation:[.4,.7],itemStyle:{gapWidth:3}},{itemStyle:{gapWidth:2}},{colorSaturation:[.4,.85]}]}];
 chart.setOption(option);chart.on('click',(p:any)=>setEvent(`${p.dataType||'node'}: ${p.name} ${p.value==null?'':`· ${p.value}`}`));
 const bridge=registerChart(el,{version:1,capture:()=>captureECharts(chart,el),getMarks:()=>echartsMarks(chart,({data,dataType}):ChartMember|null=>{
  if(mode==='Treemap'){if(data.children?.length)return null;return {key:`service/${data.name}`,label:data.name,kind:'tile',values:{value:data.value}};}
  if(dataType==='edge')return {key:JSON.stringify(['flow',data.source,data.target]),label:`${data.source} → ${data.target}`,kind:'link',values:{value:data.value,source:data.source,target:data.target}};
  return {key:`node/${data.name}`,label:data.name,kind:'node'};
 })});chart.on('rendered',bridge.changed);
 const ro=new ResizeObserver(()=>chart.resize());ro.observe(el);
 return ()=>{ro.disconnect();chart.off('rendered',bridge.changed);bridge.dispose();chart.dispose();};},[mode,renderer,reset,flow]);
 return <>
 <div className="toolbar"><Choices label="Structure" value={mode} options={['Sankey','Treemap']} onChange={setMode}/><Choices label="ECharts renderer" value={renderer} options={['Canvas','SVG']} onChange={setRenderer}/><button {...anno("charts.E.control.reset","Reset structure layout")} onClick={()=>{setReset(v=>v+1);setEvent('Layout reset');}}>Reset layout</button></div>
 <Ledger>{mode==='Sankey'?<><span><b>24</b> nodes</span><span><b>54</b> weighted links</span><span><b>4</b> stages</span></>:<><span><b>96</b> leaves</span><span><b>3</b> hierarchy levels</span><span><b>4</b> regions</span></>}<span><b>{renderer}</b> active surface</span></Ledger>
 <SaveAsImage id={`structure-${renderer.toLowerCase()}`}><div {...anno("charts.E.plot","Flow and hierarchy chart",{mode:"chart",semantic:{kind:"chart",synthetic:true}})} className="plot structure" ref={ref} data-renderer={renderer.toLowerCase()} role="img" aria-label={mode==='Sankey'?'Four-stage flow graph, 24 draggable nodes and 54 weighted links':'Treemap with 96 leaf services and three hierarchy levels'}/></SaveAsImage>
 <div className="notes">Try: curved links and adjacency hover; drag Sankey nodes. Treemap: nested rectangles, drill into a region/team, use the breadcrumb to return. Both modes use identical data across renderers; Sankey link weights are arbitrary test values, not a balanced financial flow.</div>
 <Status value={event}/>
 </>;
}

function Spatial({stress}:{stress:boolean}){
 const [enabled,setEnabled]=useState(false);
 const [event,setEvent]=useState(''),[error,setError]=useState(''),[turn,setTurn]=useState(false),[rev,setRev]=useState(0),[count,setCount]=useState(0);
 const ref=useRef<HTMLDivElement>(null); const api=useRef<{controls:OrbitControls}|null>(null);const auto=useRef(false);
 useEffect(()=>{auto.current=turn;},[turn]);
 useEffect(()=>{
  if(!ref.current)return;const el=ref.current;setError('');if(!enabled){setCount(0);return;}let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});}catch{setError('WebGL unavailable in this browser/device. No Canvas2D fallback is used, so the test remains honest.');return;}
  renderer.setClearColor(0xf8fafc);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.domElement.setAttribute('aria-label','3D scatter cloud with orbit controls');renderer.domElement.dataset.renderer='webgl';
  el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(44,1,.1,1000);camera.position.set(65,52,72);camera.lookAt(0,5,0);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.autoRotateSpeed=.8;controls.target.set(0,5,0);api.current={controls};
  const n=stress?30000:8000,r=rng(550),positions=new Float32Array(n*3),rgb=new Float32Array(n*3),meta:any[]=[];
  for(let i=0;i<n;i++){const g=i%4,angle=r()*Math.PI*2,radius=3+Math.sqrt(r())*12,x=Math.cos(angle)*radius+(g%2?13:-13),z=Math.sin(angle)*radius+(g>1?12:-12),y=(r()+r()+r())*8+g*2;positions.set([x,y,z],i*3);const color=new THREE.Color(colors[g]);rgb.set([color.r,color.g,color.b],i*3);meta.push({id:i,cluster:g+1,x:+x.toFixed(2),y:+y.toFixed(2),z:+z.toFixed(2)});}
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.BufferAttribute(positions,3));geom.setAttribute('color',new THREE.BufferAttribute(rgb,3));
  const mat=new THREE.PointsMaterial({size:.46,vertexColors:true,sizeAttenuation:true,transparent:true,opacity:.84});
  const points=new THREE.Points(geom,mat);scene.add(points);
  const grid=new THREE.GridHelper(64,16,0x94a3b8,0xe2e8f0);scene.add(grid);
  const axes=new THREE.AxesHelper(32);scene.add(axes);
  const selectionGeom=new THREE.SphereGeometry(.75,16,8),selectionMat=new THREE.MeshBasicMaterial({color:0x0f172a,wireframe:true});
  const selected=new THREE.Mesh(selectionGeom,selectionMat);selected.visible=false;scene.add(selected);
  const ray=new THREE.Raycaster();ray.params.Points={threshold:.7};const pointer=new THREE.Vector2();
  let down={x:0,y:0};
  const onDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
  const pick=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const b=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObject(points)[0];if(hit?.index!==undefined){const m=meta[hit.index];selected.position.fromArray(positions,hit.index*3);selected.visible=true;setEvent(`Point ${m.id} · Cluster ${m.cluster} · x ${m.x}, y ${m.y}, z ${m.z}`);}};
  renderer.domElement.addEventListener('pointerdown',onDown);renderer.domElement.addEventListener('pointerup',pick);
  const ro=new ResizeObserver(()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();});ro.observe(el);
  let commenting=false;
  const bridge=registerChart(el,{version:1,getMarks:()=>{
   const w=el.clientWidth,h=el.clientHeight,p=new THREE.Vector3(),marks:ChartMark[]=[];
   for(let i=0;i<meta.length;i++){p.fromArray(positions,i*3).project(camera);if(p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1)continue;
    const m=meta[i];marks.push({key:`point/${m.id}`,label:`Point ${m.id} · Cluster ${m.cluster}`,kind:'point',values:{x:m.x,y:m.y,z:m.z,cluster:m.cluster},geometry:pointGeometry((p.x+1)*w/2,(1-p.y)*h/2,3)});
   }return marks;
  },setCommentMode:active=>{commenting=active;},capture:()=>{const copy=document.createElement('canvas');copy.width=renderer.domElement.width;copy.height=renderer.domElement.height;copy.getContext('2d')!.drawImage(renderer.domElement,0,0);return copy;}});
  controls.addEventListener('change',bridge.changed);
  let raf=0;const draw=()=>{controls.autoRotate=auto.current&&!commenting;controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(draw);};draw();setCount(n);
  return ()=>{cancelAnimationFrame(raf);ro.disconnect();controls.removeEventListener('change',bridge.changed);bridge.dispose();controls.dispose();renderer.domElement.removeEventListener('pointerdown',onDown);renderer.domElement.removeEventListener('pointerup',pick);geom.dispose();mat.dispose();selectionGeom.dispose();selectionMat.dispose();grid.geometry.dispose();(grid.material as THREE.Material).dispose();axes.geometry.dispose();(axes.material as THREE.Material).dispose();renderer.dispose();renderer.forceContextLoss();el.replaceChildren();api.current=null;};
 },[stress,rev,enabled]);
 return <>
 <div className="toolbar"><label><input {...anno("charts.F.control.enable","Enable WebGL example")} type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);setTurn(false);}}/> Enable WebGL example</label><button {...anno("charts.F.control.reset","Reset camera")} disabled={!enabled} onClick={()=>{setTurn(false);setRev(v=>v+1);setEvent('Camera reset');}}>Reset camera</button><label><input {...anno("charts.F.control.rotate","Auto-rotate spatial chart")} type="checkbox" disabled={!enabled} checked={turn} onChange={e=>setTurn(e.target.checked)}/> Auto-rotate</label><span className="hint">Optional · requires a WebGL-capable browser</span></div>
 <Ledger><span><b>{fmt(count)}</b> 3D points</span><span><b>4</b> clusters</span><span><b>Orbit + zoom + pick</b></span></Ledger>
 {error?<div className="error" role="alert">{error}</div>:null}
 <SaveAsImage id="spatial-webgl"><div {...anno("charts.F.plot","Spatial WebGL chart",{mode:"chart",semantic:{kind:"chart",synthetic:true}})} className="plot spatial" ref={ref} data-renderer="webgl" data-enabled={enabled} role="img" aria-label="Three.js WebGL 3D scatterplot: rotate, zoom, or click points"/></SaveAsImage>
 <div className="mini-legend">{colors.slice(0,4).map((c,i)=><span key={c}><i style={{background:c}}/>Cluster {i+1}</span>)}<span>X = red · Y = green · Z = blue axes; arbitrary units.</span></div>
 <div className="notes">Try: overlapping/occluded points, perspective, camera movement and point picking. A single canvas holds a WebGL scene; individual points are not DOM elements. Stress mode: 30,000 points. Browser/GPU support required.</div>
 <Status value={event}/>
 </>;
}

const manifest={
 title:'Chart coverage lab',version:'1.1.0',seed:'fixed per fixture',data:'synthetic',runtime:'same-DOM React fixture; host owns live comments; no CDN; WebGL opt-in',
 basicExamples:['five-category bar','twelve-day line','five-slice pie','24-point scatter','eight-node force / Sankey','image-only export without membership'],
 coverage:[
 {id:'A',library:'Recharts 3.5.1',renderers:['SVG'],geometries:['stacked bar','mixed line','range area','reference line','brush'],points:'120 rows; 360 stacked values'},
 {id:'B',library:'Nivo line 0.99.0',renderers:['SVG','Canvas2D'],geometries:['dense lines','missing values','threshold','nearest-point interaction'],points:'6,000 / 24,000 sample slots'},
 {id:'C',library:'Nivo pie 0.99.0; ReportLab 4.4.4',renderers:['SVG','PNG raster'],geometries:['donut','pie','radial labels','custom SVG center'],points:'18 categories; same values across modes'},
 {id:'D',library:'vega-embed 7.1.0; Vega 6.2.0; Vega-Lite 6.4.1',renderers:['SVG','Canvas2D'],geometries:['scatter','binned heatmap','scale zoom','selection'],points:'6,000 / 20,000 observations'},
 {id:'E',library:'ECharts 6.0.0',renderers:['SVG','Canvas2D'],geometries:['Sankey','treemap','curved edges','nested rectangles','drilldown'],points:'24 nodes / 54 edges; 96 leaves'},
 {id:'F',library:'Three.js 0.180.0',renderers:['WebGL'],geometries:['3D scatter','occlusion','orbit','raycast picking'],points:'8,000 / 30,000 points'}
 ],exclusions:'Not exhaustive library parity, not a benchmark, no geographic lookup or automatic membership inference. No geographic maps, every Nivo variant, Perspective wrapper, or extra graph libraries; omitted to keep independent geometry/renderer cases compact.'
};
export function ChartExamples(){
 const [stress,setStress]=useState(false);
 // Opening a bookmarked advanced chart also opens its enclosing disclosure.
 useEffect(()=>{const reveal=()=>{const target=document.getElementById(location.hash.slice(1));if(!target?.closest('.chart-examples'))return;for(let p=target.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement)p.open=true;requestAnimationFrame(()=>target.scrollIntoView({block:'start',behavior:'instant'}));};reveal();window.addEventListener('hashchange',reveal);return()=>window.removeEventListener('hashchange',reveal);},[]);
 const widgets=[
 <Fixture key="A" id="A" title="Mixed Cartesian layers" sub="Stacked columns beneath two lines, a range band and reference geometry." library="Recharts 3.5.1 · SVG"><Mixed/></Fixture>,
 <Fixture key="B" id="B" title="Dense multi-series signals" sub="The same high-density paths rendered as SVG or Canvas2D." library="@nivo/line 0.99.0"><DenseLines stress={stress}/></Fixture>,
 <Fixture key="C" id="C" title="Radial geometry & raster image" sub="Eighteen unequal categories; switch geometry without adding another example." library="@nivo/pie 0.99.0 · ReportLab 4.4.4"><Composition/></Fixture>,
 <Fixture key="D" id="D" title="Point cloud & binned density" sub="Thousands of marks or aggregated cells; SVG/Canvas parity on one dataset." library="vega-embed 7.1.0 · Vega 6.2.0 · Vega-Lite 6.4.1"><VegaDensity stress={stress}/></Fixture>,
 <Fixture key="E" id="E" title="Flow & hierarchy" sub="Weighted relationships and nested regions in two renderers." library="ECharts 6.0.0"><Structures/></Fixture>,
 <Fixture key="F" id="F" title="Spatial cloud & camera" sub="A true WebGL scene: depth, occlusion, orbit and raycast selection." library="Three.js 0.180.0"><Spatial stress={stress}/></Fixture>
 ];
 return <section className="chart-examples" aria-labelledby="chart-examples-title" id="chart-examples">
 <header className="mast"><div><span className="eyebrow">SYNTHETIC CHART EXAMPLES</span><h2 id="chart-examples-title" className="chart-title" {...annoText("charts.title","Chart coverage lab")}>Chart coverage lab<span>Start simple. Explore deeper.</span></h2><p>Small examples of common dashboard charts, followed by denser layouts and alternate renderers. Turn Comment mode off to interact with the charts.</p></div><span className="build-tag">progressive examples</span></header>
 <nav aria-label="Chart families" className="tabs">{[['cartesian','Bar & line'],['composition','Pie & image'],['observations','Scatter'],['relationships','Graphs'],['spatial','3D · optional']].map(([id,label])=><a key={id} href={`#family-${id}`}>{label}</a>)}</nav>
 <p className="view-note">Click a chart mark or drag a rectangle in Comment mode. Selected identities stay fixed as charts change; original images stay with the discussion.</p>
 <Family id="cartesian" title="Bar and line charts" description="Start with a category or a date. Explore overlapping series and dense rendering when needed.">
  <div className="recipe-grid"><SimpleBar/><SimpleLine/></div>
  <Advanced id="cartesian" title="Advanced: mixed layers and dense signals">{widgets[0]}{widgets[1]}</Advanced>
 </Family>
 <Family id="composition" title="Pie charts and exported images" description="A category keeps its identity as its share changes. An image-only export supports rectangular comments without a data mapping.">
  <div className="recipe-grid"><SimplePie/><ImageOnlyExample/></div>
  <Advanced id="composition" title="Advanced: eighteen slices, donut and raster variants">{widgets[2]}</Advanced>
 </Family>
 <Family id="observations" title="Scatterplots and aggregates" description="A point has an observation key. A heatmap cell represents an aggregate of observations.">
  <SimpleScatter/>
  <Advanced id="observations" title="Advanced: dense scatter, heatmap, zoom and alternate renderers">{widgets[3]}</Advanced>
 </Family>
 <Family id="relationships" title="Nodes and relationships" description="The same node and link identities can be rendered in different places and different layouts.">
  <RelationshipGraph/>
  <Advanced id="relationships" title="Advanced: larger flows and a nested treemap">{widgets[4]}</Advanced>
 </Family>
 <Family id="spatial" title="3D and camera movement" description="Optional WebGL coverage. No WebGL context or animation loop starts until explicitly enabled.">
  <Advanced id="spatial" title="Optional: enable the spatial cloud">{widgets[5]}</Advanced>
 </Family>
 <div className="controlbar"><span>Advanced examples</span><label><input {...anno("charts.control.stress","Stress data for B, D and F")} type="checkbox" checked={stress} onChange={e=>setStress(e.target.checked)}/> Stress data <span className="hint">(B, D, enabled F)</span></label><button {...anno("charts.control.manifest","Download test manifest")} onClick={()=>downloadJSON(manifest,'chart-coverage-manifest.json')}>Download test manifest</button></div>
 <details className="coverage"><summary>Coverage matrix & testing contract</summary>
 <div className="table-scroll"><table><thead><tr><th>Fixture</th><th>Library</th><th>Renderer</th></tr></thead><tbody>{manifest.coverage.map(c=><tr key={c.id}><td>{c.id} · {c.geometries.slice(0,2).join(' + ')}</td><td>{c.library}</td><td>{c.renderers.join(' / ')}</td></tr>)}</tbody></table></div>
 <ul><li><strong>Deterministic input; no real business data.</strong> Charts fetch no data, credentials, remote fonts or external scripts. Chart state is in memory; comments use the existing review server. Animations disabled except optional WebGL orbit.</li><li><strong>Stable anchors:</strong> <code>#fixture-A</code>…<code>#fixture-F</code>, <code>data-fixture</code>, <code>data-renderer</code>, <code>data-export-target</code>. The existing annotation layer sees stable charts.* targets on sections, controls and plot surfaces. PNG mode also declares an image-region target. Chart adapters supply stable member identities and current geometry through the same contract. PNG targets explicitly use image-only selection.</li><li><strong>What counts:</strong> sample slots include explicit nulls; actual non-null count is shown in B. SVG paths may encode thousands of points in a single element; DOM count is not data count.</li><li><strong>Save PNG:</strong> a local SaveAsImage wrapper uses html-to-image 1.11.13; right-click or use its button. Vega uses its built-in export menu. WebGL export requires a functioning GPU context.</li><li><strong>Minimal, not exhaustive:</strong> {manifest.exclusions}</li><li><strong>Source / version scope:</strong> versions shown are the packages pinned for this build. PNG rasterization on this VM uses PyMuPDF 1.26.4.</li><li><strong>Mobile:</strong> full control access and stacked labels. Dense plots retain all data but fewer axis labels; fullscreen is easier for precision pointing. No assertion of WCAG conformance or performance equivalence.</li></ul>
 </details>
 <footer>Purpose-built for chart rendering / selection / annotation testing · fixed seeds · no source dashboards modified</footer>
 </section>;
}

function Family({id,title,description,children}:{id:string,title:string,description:string,children:React.ReactNode}){
 return <section className="chart-family" id={`family-${id}`} aria-labelledby={`family-${id}-title`}>
  <h2 id={`family-${id}-title`} {...annoText(`charts.family.${id}.heading`,title)}>{title}</h2><p className="family-description">{description}</p>{children}
 </section>;
}
function Advanced({id,title,children}:{id:string,title:string,children:React.ReactNode}){
 return <details className="advanced-examples" data-advanced={id}><summary>{title}</summary><div className="advanced-content">{children}</div></details>;
}
