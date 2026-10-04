import { getChart, type ChartGeometry, type ChartMark, type ChartMember, type ChartRect } from '../chart';
import type { Box, ChartRef, Target, TargetLayout } from './types';

const finite = (n: number) => Number.isFinite(n);
function jsonValue(value:unknown,depth=0):boolean {
  if(depth>12)return false;
  if(value===null||typeof value==='string'||typeof value==='boolean')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.every(v=>jsonValue(v,depth+1));
  return typeof value==='object'&&!!value&&Object.values(value).every(v=>jsonValue(v,depth+1));
}
export function chartMarks(target: Target): { marks: readonly ChartMark[] | null; reason?: string } {
  try {
    const marks=getChart(target.el)?.getMarks() ?? null;
    if (!marks) return { marks:null,reason:'Data membership is unavailable. This selection records an image region.' };
    const keys=new Set<string>();
    for(const m of marks) {
      if(!m.key || typeof m.key!=='string' || m.key.length>512 || keys.has(m.key) || typeof m.label!=='string' || !m.label || m.label.length>1000) throw Error('Chart keys must be unique and labels nonempty.');
      keys.add(m.key);
      const b=m.geometry.bounds;
      if(![b.x,b.y,b.width,b.height].every(finite)||b.width<0||b.height<0) throw Error('Chart geometry is unavailable.');
      const g=m.geometry;
      if(g.clip&&(![g.clip.x,g.clip.y,g.clip.width,g.clip.height].every(finite)||g.clip.width<0||g.clip.height<0))throw Error('Invalid plot clipping');
      if(g.matrix&&(g.matrix.length!==6||!Array.from(g.matrix).every(finite)))throw Error('Invalid chart transform');
      if(g.point&&![g.point.x,g.point.y,g.point.radius].every(finite))throw Error('Invalid chart point');
      if(g.path&&!(g.path instanceof Path2D))throw Error('Invalid chart path');
      if(m.kind!=null&&typeof m.kind!=='string')throw Error('Chart kind must be a string');
      if(m.values!=null&&(typeof m.values!=='object'||Array.isArray(m.values)||!jsonValue(m.values)))throw Error('Chart values must be a JSON object');
    }
    const box=target.el.getBoundingClientRect();
    return {marks:marks.flatMap(m=>{
      const clip=intersection(m.geometry.clip??{x:0,y:0,width:box.width,height:box.height},{x:0,y:0,width:box.width,height:box.height});
      if(!clip)return [];
      const bounds=intersection(m.geometry.bounds,clip);
      if(!bounds||bounds.width<=0||bounds.height<=0)return [];
      const point=m.geometry.point;
      if(point){
        const x=Math.max(clip.x,Math.min(point.x,clip.x+clip.width));
        const y=Math.max(clip.y,Math.min(point.y,clip.y+clip.height));
        if(Math.hypot(point.x-x,point.y-y)>point.radius)return [];
      }
      if(m.geometry.path&&!hitsRect(m.geometry,clip))return [];
      return [{...m,geometry:{...m.geometry,bounds,clip}}];
    })};
  } catch {
    return {marks:null,reason:'Data membership is unavailable for this view. This selection records an image region.'};
  }
}
export const intersects = (a: ChartRect,b: ChartRect) => a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
const intersection=(a:ChartRect,b:ChartRect):ChartRect|null=>{
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  return right<x||bottom<y?null:{x,y,width:right-x,height:bottom-y};
};
const contains = (r: ChartRect,x:number,y:number) => x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height;
let hitCanvas: HTMLCanvasElement | undefined;
function context() { hitCanvas ??= document.createElement('canvas');return hitCanvas.getContext('2d',{willReadFrequently:true})!; }
export function paintGeometry(ctx: CanvasRenderingContext2D,g:ChartGeometry,fill:boolean,stroke:boolean) {
  ctx.save();
  if(g.clip){ctx.beginPath();ctx.rect(g.clip.x,g.clip.y,g.clip.width,g.clip.height);ctx.clip();}
  if(g.point) {ctx.beginPath();ctx.arc(g.point.x,g.point.y,Math.max(g.point.radius,4),0,Math.PI*2);if(fill)ctx.fill();if(stroke)ctx.stroke();}
  else if(g.path) {
    if(g.matrix)ctx.transform(...g.matrix as [number,number,number,number,number,number]);
    if(fill&&g.fill!==false)ctx.fill(g.path);
    if(stroke){ctx.lineWidth=Math.max(g.strokeWidth??1,ctx.lineWidth);ctx.stroke(g.path);}
  } else {const b=g.bounds;if(fill)ctx.fillRect(b.x,b.y,b.width,b.height);if(stroke)ctx.strokeRect(b.x,b.y,b.width,b.height);}
  ctx.restore();
}
export function hitsPoint(g:ChartGeometry,x:number,y:number) {
  if(g.clip&&!contains(g.clip,x,y))return false;
  if(g.point)return Math.hypot(x-g.point.x,y-g.point.y)<=Math.max(7,g.point.radius);
  if(!contains({...g.bounds,x:g.bounds.x-4,y:g.bounds.y-4,width:g.bounds.width+8,height:g.bounds.height+8},x,y))return false;
  if(!g.path)return contains(g.bounds,x,y);
  const ctx=context();ctx.setTransform(1,0,0,1,0,0);
  if(g.matrix)ctx.setTransform(...g.matrix as [number,number,number,number,number,number]);
  ctx.lineWidth=g.fill!==false?Math.max(1,g.strokeWidth??0):Math.max(7,g.strokeWidth??0);
  return (g.fill!==false&&ctx.isPointInPath(g.path,x,y))||!!g.strokeWidth&&ctx.isPointInStroke(g.path,x,y);
}
export function hitsRect(g:ChartGeometry,r:ChartRect) {
  if(g.clip){const visible=intersection(r,g.clip);if(!visible)return false;r=visible;}
  if(g.point)return contains(r,g.point.x,g.point.y);
  if(!intersects(g.bounds,r))return false;
  if(!g.path||contains(r,g.bounds.x,g.bounds.y)&&contains(r,g.bounds.x+g.bounds.width,g.bounds.y+g.bounds.height))return true;
  // Test the actual rendered path, not its bounding box. Native raster coverage
  // provides a one-CSS-pixel boundary tolerance for curves, ribbons, and wedges.
  const left=Math.floor(Math.max(g.bounds.x,r.x)),top=Math.floor(Math.max(g.bounds.y,r.y));
  const right=Math.ceil(Math.min(g.bounds.x+g.bounds.width,r.x+r.width)),bottom=Math.ceil(Math.min(g.bounds.y+g.bounds.height,r.y+r.height));
  const ctx=context();
  for(let y=top;y<bottom;y+=256)for(let x=left;x<right;x+=256){
    ctx.canvas.width=Math.max(1,Math.min(256,right-x));ctx.canvas.height=Math.max(1,Math.min(256,bottom-y));
    ctx.setTransform(1,0,0,1,-x,-y);ctx.fillStyle='#000';ctx.strokeStyle='#000';ctx.lineWidth=g.strokeWidth??0;
    paintGeometry(ctx,g,g.fill!==false,!!g.strokeWidth);
    const bytes=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height).data;
    for(let i=3;i<bytes.length;i+=4)if(bytes[i])return true;
  }
  return false;
}
export function pickMark(marks:readonly ChartMark[],x:number,y:number) {
  let nearest:ChartMark|undefined,distance=Infinity;
  for(let i=marks.length-1;i>=0;i--){const m=marks[i];if(!hitsPoint(m.geometry,x,y))continue;
    if(!m.geometry.point)return nearest??m;
    const d=Math.hypot(x-m.geometry.point.x,y-m.geometry.point.y);if(d<distance){nearest=m;distance=d;}
  }
  return nearest;
}
export function memberSnapshot(m:ChartMember):ChartMember {
  return JSON.parse(JSON.stringify({key:m.key,label:m.label,...(m.kind?{kind:m.kind}:{}),...(m.values?{values:m.values}:{})}));
}
export function chartSelection(target:Target,rect:ChartRect,selection:'point'|'rectangle',marks:readonly ChartMark[]|null,preview=false):ChartRef {
  const box=target.el.getBoundingClientRect();
  const available=marks?.filter(m=>intersects(m.geometry.bounds,{x:0,y:0,width:box.width,height:box.height}))??null;
  const selected=selection==='point' ? (available ? [pickMark(available,rect.x,rect.y)].filter((m):m is ChartMark=>!!m) : null)
    : available?.filter(m=>hitsRect(m.geometry,rect))??null;
  const members=selected?.map(m=>preview?{key:m.key,label:m.label,kind:m.kind}:memberSnapshot(m))??null;
  if(selection==='point'&&selected?.length){const b=selected[0].geometry.bounds;const x=Math.max(0,b.x-8),y=Math.max(0,b.y-8);rect={x,y,width:Math.max(1,Math.min(box.width,b.x+b.width+8)-x),height:Math.max(1,Math.min(box.height,b.y+b.height+8)-y)};}
  const suffix=selection==='point'&&members?.length ? members[0].label : members===null?'image region':members.length===0?'empty region':`${members.length} selected item${members.length===1?'':'s'}`;
  return {kind:'chart',version:1,id:target.id,label:`${target.label} · ${suffix}`,semantic:target.semantic,selection,members,
    region:{xPct:rect.x/box.width,yPct:rect.y/box.height,wPct:rect.width/box.width,hPct:rect.height/box.height}};
}
export interface ResolvedChart { marks:readonly ChartMark[]; available:number; total:number|null; box:Box|null; state:'members'|'image'|'empty'|'unavailable' }
export function resolveChart(ref:ChartRef,layout:TargetLayout):ResolvedChart {
  const {box}=layout;
  if(layout.hidden)return {marks:[],available:0,total:ref.members?.length??null,box:null,state:'unavailable'};
  if(ref.members===null||ref.members.length===0){const r=ref.region;return {marks:[],available:0,total:ref.members?.length??null,state:ref.members===null?'image':'empty',
    box:{left:box.left+r.xPct*box.width,top:box.top+r.yPct*box.height,width:r.wPct*box.width,height:r.hPct*box.height}};}
  const wanted=new Set(ref.members.map(m=>m.key));
  const marks=(('chartMarks' in layout?layout.chartMarks:chartMarks(layout.target).marks)??[]).filter(m=>wanted.has(m.key)&&intersects(m.geometry.bounds,{x:0,y:0,width:box.width,height:box.height}));
  if(!marks.length)return {marks,available:0,total:wanted.size,box:null,state:'unavailable'};
  const pad=ref.selection==='point'?5:8;
  const x=Math.max(0,Math.min(...marks.map(m=>m.geometry.bounds.x))-pad),y=Math.max(0,Math.min(...marks.map(m=>m.geometry.bounds.y))-pad);
  const right=Math.min(box.width,Math.max(...marks.map(m=>m.geometry.bounds.x+m.geometry.bounds.width))+pad);
  const bottom=Math.min(box.height,Math.max(...marks.map(m=>m.geometry.bounds.y+m.geometry.bounds.height))+pad);
  return {marks,available:marks.length,total:wanted.size,state:'members',box:{left:box.left+x,top:box.top+y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)}};
}

/** Keep a clicked mark usable: its badge sits above the mark. Rectangle badges
 * remain on their enclosure, matching image-region commenting. */
export function chartPin(ref:ChartRef,layout:TargetLayout) {
  const box=resolveChart(ref,layout).box;
  if(box)return {x:box.left,y:box.top+(ref.selection==='point'?0:Math.min(24,box.height))};
  return {x:layout.box.left+Math.max(12,layout.box.width-16),y:layout.box.top+16};
}

/** Object field order is not a data change. Arrays retain their semantic order. */
export function sameValues(a:unknown,b:unknown):boolean {
  const ordered=(v:unknown):unknown=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,ordered(value)])):v;
  return JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
}
