import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { registerChart, svgMarks, type ChartMember, type ChartMark } from '../../chart';
import { nivoLineMarks, nivoPieMarks } from '../../chart-adapters';

/** React wiring only; all interaction belongs to the annotation layer. */
export function useSvgChart(members:()=>readonly ChartMember[]) {
  const attached=useRef<HTMLElement|null>(null);
  const ref=useRef<HTMLDivElement>(null),get=useRef(members),bridge=useRef<ReturnType<typeof registerChart>|null>(null);
  get.current=members;
  useLayoutEffect(()=>{const el=ref.current;if(attached.current!==el){bridge.current?.dispose();attached.current=el;bridge.current=el?registerChart(el,{version:1,getMarks:()=>svgMarks(el,get.current())}):null;}bridge.current?.changed();});
  useLayoutEffect(()=>()=>{bridge.current?.dispose();attached.current=null;},[]);
  return ref;
}

function useChartBinding() {
  const attached=useRef<HTMLElement|null>(null);
  const ref=useRef<HTMLDivElement>(null),marks=useRef<readonly ChartMark[]|null>(null),bridge=useRef<ReturnType<typeof registerChart>|null>(null);
  const publish=useCallback((next:readonly ChartMark[])=>{marks.current=next;queueMicrotask(()=>bridge.current?.changed());},[]);
  useLayoutEffect(()=>{if(attached.current!==ref.current){bridge.current?.dispose();attached.current=ref.current;bridge.current=ref.current?registerChart(ref.current,{version:1,getMarks:()=>ref.current?.querySelector('svg,canvas')?marks.current:null}):null;}});
  useLayoutEffect(()=>()=>{bridge.current?.dispose();attached.current=null;},[]);
  return {ref,publish};
}
export function useNivoLineChart(margin:{left:number;top:number},identify:(point:any)=>ChartMember|null) {
  const {ref,publish}=useChartBinding(),identifyRef=useRef(identify);identifyRef.current=identify;
  const left=margin.left,top=margin.top;
  const layer=useMemo(()=>function LineGeometry(props:any){
    useLayoutEffect(()=>publish(nivoLineMarks(props.points,{left,top},p=>identifyRef.current(p))),[props.points]);
    return null;
  },[publish,left,top]);
  const canvasLayer=useCallback((_context:CanvasRenderingContext2D,props:any)=>publish(nivoLineMarks(props.points,{left,top},p=>identifyRef.current(p))),[publish,left,top]);
  return {ref,layer,canvasLayer};
}
export function useNivoPieChart(margin:{left:number;top:number},identify:(datum:any)=>ChartMember|null) {
  const {ref,publish}=useChartBinding(),identifyRef=useRef(identify);identifyRef.current=identify;
  const left=margin.left,top=margin.top;
  const layer=useMemo(()=>function PieGeometry(props:any){
    useLayoutEffect(()=>publish(nivoPieMarks(props,{left,top},d=>identifyRef.current(d))),[props.dataWithArc,props.arcGenerator,props.centerX,props.centerY]);
    return null;
  },[publish,left,top]);
  return {ref,layer};
}
