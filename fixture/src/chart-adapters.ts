/** Geometry bridges, independent of React and the commenting runtime.
 * Structural `any` at library boundaries avoids bundling chart dependencies.
 * Tested against the pinned fixture versions; applications still supply identity.
 */
import { pointGeometry, rectGeometry, type ChartMark, type ChartMember, type ChartGeometry, type ChartRect } from './chart';

/** Place a native export in the same box used by the adapter's geometry. This
 * accounts for a Vega surface smaller than its host and keeps crop fractions exact. */
export function canvasInTarget(root:HTMLElement,source:CanvasImageSource,surface:Element|null=root):HTMLCanvasElement {
  const r=root.getBoundingClientRect(),s=surface?.getBoundingClientRect()??r;
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(r.width));canvas.height=Math.max(1,Math.ceil(r.height));
  const ctx=canvas.getContext('2d')!;ctx.fillStyle=getComputedStyle(root).backgroundColor||'#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(source,s.left-r.left,s.top-r.top,s.width,s.height);return canvas;
}
export async function captureVega(view:any,root:HTMLElement):Promise<HTMLCanvasElement> {
  return canvasInTarget(root,await view.toCanvas(1),root.querySelector('svg.marks,canvas.marks'));
}
export async function captureECharts(chart:any,root:HTMLElement):Promise<HTMLCanvasElement> {
  const image=new Image();image.src=chart.getDataURL({pixelRatio:1});await image.decode();
  return canvasInTarget(root,image);
}

export function nivoLineMarks(points: readonly any[], margin:{left:number;top:number}, identify:(point:any)=>ChartMember|null):ChartMark[] {
  return points.flatMap(p=>{const member=identify(p);return member&&Number.isFinite(p.x)&&Number.isFinite(p.y)?[{...member,geometry:pointGeometry(margin.left+p.x,margin.top+p.y,4)}]:[];});
}
export function nivoPieMarks(props:any,margin:{left:number;top:number},identify:(datum:any)=>ChartMember|null):ChartMark[] {
  return props.dataWithArc.flatMap((d:any)=>{
    const member=identify(d);if(!member||d.hidden)return [];
    const a=d.arc,start=a.startAngle,end=a.endAngle;
    const angles=[start,end];for(let n=Math.ceil(Math.min(start,end)/(Math.PI/2));n*Math.PI/2<=Math.max(start,end);n++)angles.push(n*Math.PI/2);
    const cx=props.centerX+margin.left,cy=props.centerY+margin.top;
    const points=angles.flatMap(t=>[a.innerRadius,a.outerRadius].map(r=>({x:cx+Math.sin(t)*r,y:cy-Math.cos(t)*r})));
    const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    return [{...member,geometry:{bounds:{x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y},path:new Path2D(props.arcGenerator(d.arc)??''),matrix:[1,0,0,1,cx,cy],fill:true}}];
  });
}

/** Vega scenegraph coordinates include nested group translations and view padding.
 * The predicate chooses data marks, excluding guides/legends and naming aggregates.
 */
export function vegaMarks(view:any,identify:(datum:any,markType:string)=>ChartMember|null):ChartMark[] {
  const result:ChartMark[]=[],origin=view.origin(),padding=view.padding();
  const intersect=(a:ChartRect|undefined,b:ChartRect)=>{if(!a)return b;const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};};
  const walk=(node:any,ox:number,oy:number,clip?:ChartRect)=>{
    if(node.marktype){
      for(const item of node.items??[]){
        if(node.marktype==='group'){
          if(item.opacity===0)continue;
          const x=ox+(item.x||0),y=oy+(item.y||0);
          if(item.clip&&typeof item.clip!=='boolean')throw Error('Supply geometry for custom Vega clipping.');
          walk(item,x,y,item.clip?intersect(clip,{x,y,width:item.width??0,height:item.height??0}):clip);continue;
        }
        if(node.role!=='mark'||item.opacity===0)continue;
        const member=identify(item.datum,node.marktype);if(!member)continue;
        let geometry:ChartGeometry|undefined;
        if(node.marktype==='symbol')geometry=pointGeometry(ox+(item.x||0),oy+(item.y||0),Math.sqrt(item.size||64)/2);
        else if(node.marktype==='rect')geometry=rectGeometry(ox+(item.x||0),oy+(item.y||0),item.width??Math.abs(item.x2-item.x),item.height??Math.abs(item.y2-item.y));
        if(!geometry)throw Error(`Unsupported Vega mark: ${node.marktype}. Use image-only selection or supply its geometry.`);
        if(node.clip&&typeof node.clip!=='boolean')throw Error('Supply geometry for custom Vega clipping.');
        const visible=node.clip?intersect(clip,{x:ox,y:oy,width:node.group?.width??0,height:node.group?.height??0}):clip;
        if(visible)geometry.clip=visible;
        result.push({...member,geometry});
      }
    } else for(const child of node.items??[])walk(child,ox,oy,clip);
  };
  walk(view.scenegraph().root,(origin?.[0]||0)+(padding?.left||0),(origin?.[1]||0)+(padding?.top||0));
  return result;
}

function graphicGeometry(element:any):ChartGeometry|null {
  if(!element||element.ignore||element.invisible)return null;
  if(typeof element.buildPath!=='function'){
    // ECharts uses groups for graph symbols, edges, and treemap tiles. Their
    // first drawable child is the actual mark; text is attached separately.
    for(const child of element.childrenRef?.()??[]){const geometry=graphicGeometry(child);if(geometry)return geometry;}
    return null;
  }
  const path=new Path2D();element.buildPath(path,element.shape,true);
  const transform=element.getComputedTransform?.()??[1,0,0,1,0,0];
  const m=new DOMMatrix(transform),b=element.getBoundingRect();
  const corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
  const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));
  const pad=(element.style?.lineWidth??0)/2;
  return {bounds:{x:x-pad,y:y-pad,width:Math.max(...corners.map(p=>p.x))-x+2*pad,height:Math.max(...corners.map(p=>p.y))-y+2*pad},path,
    matrix:[m.a,m.b,m.c,m.d,m.e,m.f],fill:element.style?.fill!=null&&element.style.fill!=='none',strokeWidth:element.style?.stroke?element.style.lineWidth??1:0};
}
export interface EChartsDatum { data:any; dataType:'node'|'edge'|'item'; seriesId:string; seriesType:string; index:number }
export function echartsMarks(chart:any,identify:(item:EChartsDatum)=>ChartMember|null):ChartMark[] {
  const result:ChartMark[]=[];
  chart.getModel().eachSeries((series:any)=>{
    const graph=series.getGraph?.();
    const kinds:('node'|'edge'|'item')[]=graph?['edge','node']:['item'];
    for(const dataType of kinds){
      const data=series.getData(dataType==='edge'?'edge':undefined);if(!data)return;
      data.each((index:number)=>{
        const raw=data.getRawDataItem(index),member=identify({data:raw,dataType,seriesId:series.id,seriesType:series.subType,index});
        if(!member)return;
        const layout=data.getItemLayout(index);
        if(layout?.isInView===false||layout?.invisible)return;
        const geometry=graphicGeometry(data.getItemGraphicEl(index));
        if(geometry)result.push({...member,geometry:series.subType==='graph'&&dataType==='node'
          ?pointGeometry(geometry.bounds.x+geometry.bounds.width/2,geometry.bounds.y+geometry.bounds.height/2,Math.max(geometry.bounds.width,geometry.bounds.height)/2)
          :geometry});
      });
    }
  });
  return result;
}
