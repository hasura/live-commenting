import { toCanvas } from 'html-to-image';
import { getChart } from '../chart';
import type { SelectionSnapshot, Target } from './types';

/** Capture only the artifact. Annotation overlays are siblings, never in the crop. */
export async function captureSelection(target: Target, region: { xPct:number;yPct:number;wPct:number;hPct:number }): Promise<SelectionSnapshot> {
  const {el}=target;
  const capturedAt=new Date().toISOString();
  const rect=el.getBoundingClientRect();
  if(rect.width<1||rect.height<1)throw Error('The chart is not visible. Your draft is kept.');
  let background='#ffffff';
  for(let node:HTMLElement|null=el;node;node=node.parentElement){const color=getComputedStyle(node).backgroundColor;if(color!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(color)){background=color;break;}}
  let source:HTMLCanvasElement;
  const native=getChart(el)?.capture;
  if(native) source=await native();
  else if(el instanceof HTMLImageElement) {
    await el.decode();source=document.createElement('canvas');source.width=el.naturalWidth;source.height=el.naturalHeight;
    source.getContext('2d')!.drawImage(el,0,0);
  } else source=await toCanvas(el,{
    pixelRatio:1,skipFonts:true,backgroundColor:background,
    // The export starts at the target's border box. html-to-image copies computed
    // auto margins as pixels; retaining them shifts a centred chart inside its
    // own image. Only the cloned root loses its outer margin, never the live DOM
    // or the SVG's internal transforms and spacing.
    style:{margin:'0'},
    filter:node=>!(node instanceof Element&&node.hasAttribute('data-anno-ignore')),
  });
  const sx=Math.max(0,region.xPct)*source.width,sy=Math.max(0,region.yPct)*source.height;
  const sw=Math.max(1,Math.min(region.wPct*source.width,source.width-sx));
  const sh=Math.max(1,Math.min(region.hPct*source.height,source.height-sy));
  const scale=Math.min(1,1200/sw,1200/sh);
  const output=document.createElement('canvas');output.width=Math.max(1,Math.round(sw*scale));output.height=Math.max(1,Math.round(sh*scale));
  const ctx=output.getContext('2d')!;ctx.fillStyle=background;ctx.fillRect(0,0,output.width,output.height);
  ctx.drawImage(source,sx,sy,sw,sh,0,0,output.width,output.height);
  const dataUrl=output.toDataURL('image/png');
  if(dataUrl.length>2_800_000)throw Error('The selected image is too large. Select a smaller region. Your draft is kept.');
  return {dataUrl,width:output.width,height:output.height,capturedAt};
}
