import type { AnnotationDoc } from './types';
import { bodyText } from './store';

/**
 * Prompt-ready text for a document. Needs no DOM: ref labels, semantics, quotes
 * and regions were snapshotted at creation, which is what keeps this readable
 * after the element a comment pointed at has stopped existing.
 */
export function flattenAnnotations(doc: AnnotationDoc): string {
  const lines = [`# Annotation review`];
  for (const t of doc.threads) {
    lines.push(`\n## ${t.id} · ${t.status}`);
    for (const r of t.refs) {
      lines.push(`Target: ${r.label ?? r.id} [${r.id}] (${r.kind})`);
      if (r.semantic) lines.push(`Semantic: ${JSON.stringify(r.semantic)}`);
      if (r.kind === 'text') lines.push(`Quote: ${JSON.stringify(r.quote)}; block offsets ${r.start}–${r.end}`);
      if (r.kind === 'region') lines.push(`Region fractions: ${r.xPct}, ${r.yPct}, ${r.wPct}, ${r.hPct}`);
    }
    for (const c of t.comments) lines.push(`${c.author.name} (${c.createdAt}): ${bodyText(c.body)}`);
    if (t.resolution) {
      const who = `${t.resolution.actor.name}${t.resolution.actorKind === 'bot' ? ' (bot)' : ''}`;
      lines.push(`Resolved by ${who} (${t.resolution.at})${t.resolution.note ? `: ${t.resolution.note}` : ''}`);
    }
  }
  return lines.join('\n');
}