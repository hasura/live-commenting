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
      if (r.kind === 'chart') {
        lines.push(`Chart selection: ${r.selection}; membership: ${r.members===null?'unavailable':r.members.length}`);
        for(const member of r.members??[])lines.push(`Member: ${member.key} · ${member.label}${member.values?` · ${JSON.stringify(member.values)}`:''}`);
        lines.push(`Original region: ${JSON.stringify(r.region)}`);
      }
      if(r.snapshot)lines.push(`Selection image: ${r.snapshot.id??'pending'} · ${r.snapshot.width}×${r.snapshot.height} · ${r.snapshot.capturedAt}`);
    }
    for (const e of logOf(t)) {
      if (e.kind === 'comment') lines.push(`${e.author.name} (${e.createdAt}) [comment ${e.id}]: ${bodyText(e.body)}`);
      else if (e.kind === 'edit') lines.push(`${e.author.name} (${e.at}) [corrected comment ${e.commentId}]: ${bodyText(e.body)}`);
      else {
        lines.push(`${e.actor.name} (${e.at}): ${e.kind === 'error' ? 'ERROR' : e.kind === 'resolve' ? 'RESOLVED' : 'REOPENED'}${e.note ? ` — ${e.note}` : ''}`);
      }
    }
  }
  return lines.join('\n');
}
