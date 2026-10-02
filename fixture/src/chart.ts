/** Artifact-side chart contract. No React, annotation runtime, or chart-library
 * imports. Geometry is ephemeral, in CSS pixels relative to the target's border
 * box; keys, labels and values are JSON snapshots. See INSTRUCTIONS.md § Charts.
 */
export type ChartValue = string | number | boolean | null | ChartValue[] | { [key: string]: ChartValue };
export interface ChartMember {
  key: string;
  label: string;
  kind?: string;
  values?: Record<string, ChartValue>;
}
export interface ChartRect { x: number; y: number; width: number; height: number }
export interface ChartGeometry {
  bounds: ChartRect;
  /** Optional visible plot bounds, in target CSS pixels. Never page/scroll clipping. */
  clip?: ChartRect;
  /** Point membership uses its centre. Picking has a small pointer tolerance. */
  point?: { x: number; y: number; radius: number };
  /** A filled or stroked native path; matrix maps path coordinates to target CSS pixels. */
  path?: Path2D;
  matrix?: readonly number[];
  fill?: boolean;
  strokeWidth?: number;
}
export interface ChartMark extends ChartMember { geometry: ChartGeometry }
export interface ChartAdapter {
  version: 1;
  /** Painter order, back to front. null means membership is unavailable, [] means empty. */
  getMarks: () => readonly ChartMark[] | null;
  /** Optional native export. Must capture the full target box, before overlays. */
  capture?: () => HTMLCanvasElement | Promise<HTMLCanvasElement>;
  /** Pause animation while selecting. Preserve the application's prior state. */
  setCommentMode?: (active: boolean) => void;
}
export const CHART_CHANGE = 'anno-chart-change';
export const CHART_PROPERTY = '__annoChartV1';
type ChartElement = HTMLElement & { __annoChartV1?: ChartAdapter };

export function registerChart(element: HTMLElement, adapter: ChartAdapter) {
  const el = element as ChartElement;
  el.__annoChartV1 = adapter;
  const changed = () => el.dispatchEvent(new CustomEvent(CHART_CHANGE, { bubbles: true }));
  changed();
  return { changed, dispose() {
    if (el.__annoChartV1 !== adapter) return;
    adapter.setCommentMode?.(false);
    delete el.__annoChartV1;
    changed();
  } };
}
export function getChart(element: HTMLElement): ChartAdapter | undefined {
  const adapter = (element as ChartElement).__annoChartV1;
  return adapter?.version === 1 ? adapter : undefined;
}
export function pointGeometry(x: number, y: number, radius = 4): ChartGeometry {
  return { bounds: { x: x-radius, y: y-radius, width: radius*2, height: radius*2 }, point: { x, y, radius } };
}
export function rectGeometry(x: number, y: number, width: number, height: number): ChartGeometry {
  return { bounds: { x, y, width, height } };
}

/** Explicitly tagged SVG geometry. A tag is a data key, never a DOM-order guess. */
export function svgGeometry(element: SVGGraphicsElement, root: HTMLElement): ChartGeometry | null {
  const screen = element.getScreenCTM();
  if (!screen || !element.getClientRects().length) return null;
  const box = root.getBoundingClientRect(), local = element.getBBox();
  const matrix = new DOMMatrix([screen.a,screen.b,screen.c,screen.d,screen.e-box.left,screen.f-box.top]);
  const corners = [[local.x,local.y],[local.x+local.width,local.y],[local.x,local.y+local.height],[local.x+local.width,local.y+local.height]]
    .map(([x,y]) => new DOMPoint(x,y).matrixTransform(matrix));
  const x = Math.min(...corners.map(p=>p.x)), y = Math.min(...corners.map(p=>p.y));
  const bounds = {x,y,width:Math.max(...corners.map(p=>p.x))-x,height:Math.max(...corners.map(p=>p.y))-y};
  const path = new Path2D();
  if (element instanceof SVGPathElement) path.addPath(new Path2D(element.getAttribute('d') ?? ''));
  else if (element instanceof SVGRectElement) path.rect(element.x.baseVal.value,element.y.baseVal.value,element.width.baseVal.value,element.height.baseVal.value);
  else if (element instanceof SVGCircleElement) path.arc(element.cx.baseVal.value,element.cy.baseVal.value,element.r.baseVal.value,0,Math.PI*2);
  else if (element instanceof SVGEllipseElement) path.ellipse(element.cx.baseVal.value,element.cy.baseVal.value,element.rx.baseVal.value,element.ry.baseVal.value,0,0,Math.PI*2);
  else if (element instanceof SVGLineElement) { path.moveTo(element.x1.baseVal.value,element.y1.baseVal.value);path.lineTo(element.x2.baseVal.value,element.y2.baseVal.value); }
  else if(element instanceof SVGPolygonElement||element instanceof SVGPolylineElement){for(let i=0;i<element.points.numberOfItems;i++){const p=element.points.getItem(i);if(i===0)path.moveTo(p.x,p.y);else path.lineTo(p.x,p.y);}if(element instanceof SVGPolygonElement)path.closePath();}
  else return null;
  if(element instanceof SVGCircleElement){const center=new DOMPoint(element.cx.baseVal.value,element.cy.baseVal.value).matrixTransform(matrix);return pointGeometry(center.x,center.y,Math.max(2,element.r.baseVal.value*Math.hypot(matrix.a,matrix.b)));}
  const style = getComputedStyle(element);
  const strokeWidth=style.stroke==='none'?0:parseFloat(style.strokeWidth)||1;
  const nonScaling=style.vectorEffect==='non-scaling-stroke';
  const pad=strokeWidth*(nonScaling?1:Math.max(Math.hypot(matrix.a,matrix.b),Math.hypot(matrix.c,matrix.d)))/2;
  const strokedBounds={x:bounds.x-pad,y:bounds.y-pad,width:bounds.width+pad*2,height:bounds.height+pad*2};
  if(nonScaling){const projected=new Path2D();projected.addPath(path,matrix);return {bounds:strokedBounds,path:projected,fill:style.fill!=='none',strokeWidth};}
  return { bounds:strokedBounds, path, matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],fill:style.fill!=='none',strokeWidth };
}
export function svgMarks(root: HTMLElement, members: readonly ChartMember[]): ChartMark[] {
  const byKey = new Map(members.map(m=>[m.key,m]));
  return [...root.querySelectorAll<SVGGraphicsElement>('[data-anno-mark]')].flatMap(el=>{
    const member=byKey.get(el.getAttribute('data-anno-mark')!);
    const geometry=svgGeometry(el,root);
    if(member&&!geometry&&el.getClientRects().length)throw Error('Tag an SVG shape or supply its geometry; group inference is unsupported.');
    return member&&geometry ? [{...member,geometry}] : [];
  });
}
