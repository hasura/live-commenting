import { anno, annoText, annoRegion } from '../../anno';

// Intentionally no chart data, slice map, or charting runtime. A generated app
// may receive only an exported image. Do not infer membership from its pixels.
export function ImageOnlyExample() {
  return <article {...anno('charts.basic.raster', 'Image-only chart example')} className="recipe" data-basic="raster">
    <h3 {...annoText('charts.basic.raster.heading', 'Image-only chart', {chartId:'charts.basic.raster.image',role:'title'})}>Image-only chart</h3>
    <p {...annoText('charts.basic.raster.subtitle', 'Image-only chart subtitle', {chartId:'charts.basic.raster.image',role:'subtitle'})} className="recipe-caption">An exported chart with no data mapping. Turn on Comment mode and drag a rectangle to comment on the image.</p>
    <img {...annoRegion('charts.basic.raster.image', 'Exported composition chart', {
      kind: 'image', membership: 'unavailable', src: '/chart-composition.png',
    })} className="image-only-chart" src="/chart-composition.png" alt="Exported pie chart with eighteen coloured segments" />
    <p className="recipe-status">Image region only · no point or slice identities available</p>
  </article>;
}
