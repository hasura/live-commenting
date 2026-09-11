import type { AnnotationDoc, Ref, Thread } from './types';
import { bodyText } from './store';

export function flattenAnnotations(doc: AnnotationDoc): string {
  const lines = [`# Annotation review`, `Artifact version: ${doc.artifactVersion ?? 'unspecified'}`];
  for (const t of doc.threads) {
    lines.push(`\n## ${t.id} · ${t.status}${t.closedRoundId ? ' · sent' : ''}${t.anchorState ? ` · ${t.anchorState}` : ''}`);
    for (const r of t.refs) {
      lines.push(`Target: ${r.label ?? r.id} [${r.id}] (${r.kind})`);
      if (r.semantic) lines.push(`Semantic: ${JSON.stringify(r.semantic)}`);
      if (r.kind === 'text') lines.push(`Quote: ${JSON.stringify(r.quote)}; block offsets ${r.start}–${r.end}`);
      if (r.kind === 'region') lines.push(`Region fractions: ${r.xPct}, ${r.yPct}, ${r.wPct}, ${r.hPct}`);
    }
    for (const c of t.comments) lines.push(`${c.author.name} (${c.createdAt}): ${bodyText(c.body)}`);
  }
  return lines.join('\n');
}

/** Sending creates immutable history; current discussions remain visible but locked. */
export function closeRound(doc: AnnotationDoc, artifactSnapshot?: string, id = crypto.randomUUID()): AnnotationDoc {
  const pending = doc.threads.filter(t => !t.closedRoundId);
  if (!pending.length) return doc;
  const round = {id, createdAt: new Date().toISOString(), artifactVersion: doc.artifactVersion,
    threads: structuredClone(pending), artifactSnapshot};
  return {...doc, rounds: [...(doc.rounds ?? []),round],
    threads: doc.threads.map(t => t.closedRoundId ? t : {...t,closedRoundId: id})};
}

export interface ManifestEntry {
  id: string;
  label: string;
  /** Content fingerprint provided by generator/host. */
  fingerprint: string;
  supersedes?: string;
}
export interface RevisionResult { valid: boolean; errors: string[]; }

/** Enforces declared continuity, NOT semantic equivalence of arbitrary HTML. */
export function validateRevision(before: ManifestEntry[], after: ManifestEntry[]): RevisionResult {
  const errors: string[] = [];
  const old = new Map(before.map(t => [t.id,t]));
  const ids = new Set<string>(), replacements = new Set<string>();
  for (const t of before) if (before.filter(x => x.id === t.id).length > 1) errors.push(`Duplicate previous id: ${t.id}`);
  for (const t of after) {
    if (ids.has(t.id)) errors.push(`Duplicate id: ${t.id}`);
    ids.add(t.id);
    if (old.has(t.id) && old.get(t.id)!.fingerprint !== t.fingerprint) errors.push(`Changed content reused id: ${t.id}`);
    if (t.supersedes) {
      if (!old.has(t.supersedes)) errors.push(`Unknown predecessor: ${t.supersedes}`);
      if (replacements.has(t.supersedes)) errors.push(`Ambiguous replacement: ${t.supersedes}`);
      replacements.add(t.supersedes);
      if (t.supersedes === t.id || after.some(x => x.id === t.supersedes)) errors.push(`Predecessor still present: ${t.supersedes}`);
    }
  }
  for (const id of old.keys()) if (!ids.has(id) && !replacements.has(id)) errors.push(`Missing continuity: ${id}`);
  return {valid: errors.length === 0,errors: [...new Set(errors)]};
}

/** Pure reconciliation. Subselection cannot survive a rewrite: keep it in the tray. */
export function reconcileRevision(doc: AnnotationDoc, after: ManifestEntry[], version: string): AnnotationDoc {
  const ids = new Set(after.map(x => x.id));
  const refsFor = (t: Thread): {refs: Ref[]; anchorState: Thread['anchorState']} => {
    let missing = false, addressed = false;
    const refs = t.refs.map(r => {
      if (ids.has(r.id)) return r;
      const replacements = after.filter(x => x.supersedes === r.id);
      if (replacements.length === 1 && r.kind === 'anno_id') {
        addressed = true;
        return {...r,id: replacements[0].id};
      }
      missing = true;
      return r;
    });
    return {refs,anchorState: missing ? 'orphaned' : addressed ? 'addressed' : 'current'};
  };
  return {...doc,artifactVersion: version,threads: doc.threads.map(t => ({...t,...refsFor(t)}))};
}
/** The safe entrypoint: an invalid generator revision never changes the doc. */
export function applyRevision(doc: AnnotationDoc, before: ManifestEntry[], after: ManifestEntry[], version: string): AnnotationDoc {
  const result = validateRevision(before,after);
  if (!result.valid) throw new Error(`Revision rejected: ${result.errors.join('; ')}`);
  return reconcileRevision(doc,after,version);
}
