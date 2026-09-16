import type { AnnotationDoc } from './types';
import { bodyText, logOf } from './store';

/**
 * Prompt-ready text for a document. Needs no DOM: ref labels, semantics, quotes
 * and regions were snapshotted at creation, which is what keeps this readable
 * after the element a comment pointed at has stopped existing.
 *
 * Each thread is printed as its log, in order — comments, resolves and reopens
 * interleaved — followed by nothing else: the effective status is in the
 * heading, the history is the lines.
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
    for (const e of logOf(t)) {
      if (e.kind === 'comment') lines.push(`${e.author.name} (${e.createdAt}): ${bodyText(e.body)}`);
      else {
        const who = `${e.actor.name}${e.actorKind === 'bot' ? ' (bot)' : ''}`;
        lines.push(`${who} (${e.at}): ${e.kind === 'resolve' ? 'RESOLVED' : 'REOPENED'}${e.note ? ` — ${e.note}` : ''}`);
      }
    }
  }
  return lines.join('\n');
}