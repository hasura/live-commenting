import { SelectionDetails } from './ChartSelection';
import type { TargetLayout } from './types';
import { ArrowUpLeft, Locate, CircleCheck, Pencil, Reply, RotateCcw, X } from 'lucide-react';
import { Hint } from './ui/tooltip';
import { useMentions } from './mentions';
import type { SubmitOptions, Author, Body, Comment, CommentEntry, EditEntry, LogEntry, Ref, Thread, ThreadStatus } from './types';
import { DraftComposer, fromEditor, toEditor, type ComposerComponent } from './Composer';
import { useDraft, useDraftPending, useDraftStore } from './drafts';
import { bodyText, hasBotMention, logOf } from './store';

/**
 * Thread popover contents: the thread's log, then reply / resolve / reopen.
 *
 * A thread contains comments and an ordered status history. Resolves and
 * reopens use the same avatar · name · time row, with a small-caps status word,
 * so they read as part of the thread rather than a marker stuck to the end.
 * The thread's *effective* state (`status`) still drives the header tag,
 * the pin colour and the resolved filter.
 *
 * Reading and replying are available whether or not comment mode is on —
 * requiring authoring mode just to read a comment would be backwards.
 *
 * Corrections retain the original entry and render the latest wording in place.
 * Replying to a resolved thread reopens it (the store logs the reopen
 * before the reply).
 */

export function ThreadList({
  threads,
  author,
  onEdit,
  layouts,
  readOnly = false,
  Composer,
  onReply,
  onResolve,
  onReopen,
  onWiden,
  widenTo,
  unanchoredIds,
  onDismiss,
  onEscape = onDismiss,
  hiddenIds,
  navigableIds,
  onShowOnPage,
  active = true,
}: {
  threads: Thread[];
  author: Author;
  onEdit: (threadId: string, commentId: string, body: Body[], options?: SubmitOptions) => void | Promise<void>;
  hiddenIds?: ReadonlySet<string>;
  navigableIds?: ReadonlySet<string>;
  onShowOnPage?: (id: string) => void;
  active?: boolean;
  layouts?: Map<string,TargetLayout>;
  readOnly?: boolean;
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[], options?: SubmitOptions) => void | Promise<void>;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onWiden?: () => void;
  widenTo?: string;
  unanchoredIds?: ReadonlySet<string>;
  /** Single-thread popups put Close inside the thread; groups close at the top. */
  onDismiss?: () => void;
  onEscape?: () => void;
}) {
  return (
    <div className="ca-threads">
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          author={author}
          onEdit={onEdit}
          layouts={layouts}
          readOnly={readOnly}
          Composer={Composer}
          onReply={onReply}
          onResolve={onResolve}
          onReopen={onReopen}
          unanchored={unanchoredIds?.has(t.id)}
          hidden={hiddenIds?.has(t.id)}
          active={active}
          onShowOnPage={onShowOnPage && navigableIds?.has(t.id) ? () => onShowOnPage(t.id) : undefined}
          onDismiss={threads.length === 1 ? onDismiss : undefined}
          onEscape={onEscape}
        />
      ))}
      {onWiden && widenTo && (
        <button className="ca-widen" onClick={onWiden}>
          <ArrowUpLeft className="ca-icon" aria-hidden="true" /> Widen to <b>{widenTo}</b>
        </button>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
  author,
  onEdit,
  layouts,
  readOnly = false,
  Composer,
  onReply,
  onResolve,
  onReopen,
  unanchored = false,
  onDismiss,
  onEscape,
  hidden = false,
  onShowOnPage,
  active,
}: {
  thread: Thread;
  author: Author;
  onEdit: (threadId: string, commentId: string, body: Body[], options?: SubmitOptions) => void | Promise<void>;
  hidden?: boolean;
  onShowOnPage?: () => void;
  active: boolean;
  layouts?: Map<string,TargetLayout>;
  readOnly?: boolean;
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[], options?: SubmitOptions) => void | Promise<void>;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  unanchored?: boolean;
  onDismiss?: () => void;
  onEscape?: () => void;
}) {
  const { directory } = useMentions();
  const draftKey = `reply:${thread.id}`;
  const drafts = useDraftStore(), replyDraft = useDraft(draftKey);
  const pending = useDraftPending();
  const target = thread.refs[0];

  return (
    <article hidden={hidden} className={`ca-thread${thread.status === 'resolved' ? ' ca-thread-resolved' : ''}`} data-thread-id={thread.id}>
      <ThreadHeading target={target} status={thread.status} unanchored={unanchored} onDismiss={onDismiss} />

      {onShowOnPage && <button className="ca-btn-ghost ca-show-on-page" onClick={onShowOnPage} disabled={pending}>
        <Locate className="ca-icon" aria-hidden="true" /> Show on page
      </button>}
      <div className="ca-thread-body" tabIndex={onDismiss ? 0 : undefined} role={onDismiss ? 'region' : undefined} aria-label={onDismiss ? 'Discussion comments' : undefined}>
        {thread.refs.map((ref,i)=><SelectionDetails key={i} reference={ref} layout={layouts?.get(ref.id)}/>)}
        {logOf(thread).map(e => e.kind === 'edit' ? null : e.kind === 'comment'
          ? <EditableComment key={e.id} original={e} comment={thread.comments.find(c => c.id === e.id) ?? e}
              edits={logOf(thread).filter((edit): edit is EditEntry => edit.kind === 'edit' && edit.commentId === e.id)}
              draftKey={`edit:${thread.id}:${e.id}`} Composer={Composer} active={active && !hidden}
              canEdit={!readOnly && e.actorKind !== 'bot' && e.author.id === author.id}
              onSubmit={(body, options) => onEdit(thread.id, e.id, body, options)} onEscape={onEscape} />
          : <Entry key={e.id} entry={e} />)}

        {thread.waitingFor && <p className="ca-waiting" role="status">Waiting for {directory?.botName ?? 'the bot'}…</p>}
        {!readOnly && (replyDraft && active && !hidden ? (
          <DraftComposer draftKey={draftKey} Composer={Composer}
            onEscape={onEscape}
            placeholder={thread.status === 'resolved' ? 'Reply and reopen…' : 'Reply…'}
            submitLabel={thread.status === 'resolved' ? 'Reply & reopen' : 'Reply'}
            onSubmit={(body, options) => onReply(thread.id, body, options)}
          />
        ) : (
          <div className="ca-thread-actions">
            <button className="ca-btn-ghost" disabled={pending} onClick={() => drafts.begin(draftKey)}>
              <Reply className="ca-icon" aria-hidden="true" /> Reply
            </button>
            {thread.status === 'open' ? (
              <button className="ca-btn-ghost" disabled={pending} onClick={() => onResolve(thread.id)}>
                <CircleCheck className="ca-icon" aria-hidden="true" /> Resolve
              </button>
            ) : (
              <button className="ca-btn-ghost" disabled={pending} onClick={() => onReopen(thread.id)}>
                <RotateCcw className="ca-icon" aria-hidden="true" /> Reopen
              </button>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Popup headings use annotation labels and status badges, not thread icons.
 * Counts of multiple threads have text-only headings.
 */
export function ThreadHeading({ target, status = 'open', unanchored = false, onDismiss }: {
  target?: Pick<Ref, 'id' | 'label'>;
  status?: ThreadStatus;
  unanchored?: boolean;
  onDismiss?: () => void;
}) {
  const state = unanchored ? (status === 'resolved' ? 'Resolved, unanchored thread' : 'Unanchored thread') : status === 'resolved' ? 'Resolved thread' : 'Open thread';
  return <header className="ca-thread-head">
    <Hint content={`${target?.label ?? target?.id ?? 'Unknown target'} · ${state} · ${target?.id ?? 'Unknown target'}`}>
      <span className="ca-thread-target" tabIndex={0} aria-label={target?.label ?? target?.id ?? 'Unknown target'}>
        <span className="ca-thread-label">{target?.label ?? target?.id ?? 'Unknown target'}</span>
      </span>
    </Hint>
    {(status === 'resolved' || unanchored) && <span className="ca-thread-badges">
      {status === 'resolved' && <span className="ca-tag">resolved</span>}
      {unanchored && <span className="ca-tag ca-tag-unanchored">unanchored</span>}
    </span>}
    {onDismiss && <CloseComments onDismiss={onDismiss} />}
  </header>;
}

export function CloseComments({ onDismiss, label = 'Close comments' }: { onDismiss: () => void; label?: string }) {
  const pending = useDraftPending();
  return <Hint content={`${label} · Esc`}>
    <button type="button" className="ca-icon-button ca-close" aria-label={label} onClick={onDismiss} disabled={pending}>
      <X className="ca-icon" aria-hidden="true" />
    </button>
  </Hint>;
}

function CommentBody({ comment }: { comment: Pick<Comment, 'body' | 'notifyBot' | 'actorKind'> }) {
  const { directory } = useMentions();
  return <p className="ca-comment-body">{comment.notifyBot && comment.actorKind !== 'bot' && !hasBotMention(comment.body) && <>
    <span className="ca-mention ca-direct-badge" title="Posted directly to the bot">@{directory?.botName ?? 'the bot'}</span>{' '}
  </>}{comment.body.map((b, i) => <span key={i}>
    {i > 0 ? ' · ' : ''}{b.kind === 'rich' ? b.content.map((s, j) => s.kind === 'mention'
      ? <span className="ca-mention" key={j}>@{s.label}</span> : s.kind === 'newline' ? '\n' : s.text) : bodyText([b])}
  </span>)}</p>;
}

function EditableComment({ original, comment, edits, draftKey, Composer, active, canEdit, onSubmit, onEscape }: {
  original: CommentEntry;
  comment: Comment;
  edits: EditEntry[];
  draftKey: string;
  Composer: ComposerComponent;
  active: boolean;
  canEdit: boolean;
  onSubmit: (body: Body[], options?: SubmitOptions) => void | Promise<void>;
  onEscape?: () => void;
}) {
  const drafts = useDraftStore(), draft = useDraft(draftKey), pending = useDraftPending();
  const editing = !!draft && active && canEdit;
  // Compare in the editor's canonical representation, including mention identities.
  const unchanged = !!draft && JSON.stringify(draft.body) === JSON.stringify(fromEditor(toEditor(comment.body)))
    && (draft.notifyBot || hasBotMention(draft.body)) === (!!comment.notifyBot || hasBotMention(comment.body));
  return <div className="ca-comment" data-entry-kind="comment" data-event-id={comment.id}>
    <div className="ca-comment-meta">
      <span className="ca-avatar">{initials(comment.author.name)}</span>
      <span className="ca-comment-author">{comment.author.name}</span>
      <time className="ca-comment-time" dateTime={comment.createdAt}>{relative(comment.createdAt)}</time>
      {canEdit && !editing && <Hint content="Edit comment">
        <button type="button" className="ca-icon-button ca-edit-comment" aria-label="Edit comment" disabled={pending}
          onClick={() => drafts.begin(draftKey, { body: fromEditor(toEditor(comment.body)), notifyBot: comment.notifyBot })}>
          <Pencil className="ca-icon" aria-hidden="true" />
        </button>
      </Hint>}
    </div>
    {editing ? <DraftComposer draftKey={draftKey} Composer={Composer} onSubmit={onSubmit} onEscape={onEscape}
      submitLabel="Save changes" pendingLabel="Saving…" submitDisabled={unchanged} placeholder="Edit comment…" />
      : <CommentBody comment={comment} />}
    {!editing && edits.length > 0 && <details className="ca-edit-history">
      <summary title={comment.editedAt ? `Edited ${new Date(comment.editedAt).toLocaleString()}` : undefined}>Edited</summary>
      <div className="ca-revisions" role="region" aria-label="Comment edit history">
        {[{ id: original.id, at: original.createdAt, body: original.body, notifyBot: original.notifyBot }, ...edits].map((revision, i) =>
          <div className="ca-revision" key={revision.id}>
            <div className="ca-revision-meta">{i === 0 ? 'Original' : i === edits.length ? 'Current' : 'Corrected'}
              {' · '}<time dateTime={revision.at}>{new Date(revision.at).toLocaleString()}</time></div>
            <CommentBody comment={revision} />
          </div>)}
      </div>
    </details>}
  </div>;
}

function Entry({ entry }: { entry: Exclude<LogEntry, CommentEntry | EditEntry> }) {
  const bot = entry.actorKind === 'bot';
  return (
    <div
      className={`ca-comment ca-status ca-status-${entry.kind}${bot ? ' ca-resolution-bot' : ''}${entry.kind === 'resolve' ? ' ca-resolution' : ''}`}
      data-entry-kind={entry.kind}
      data-event-id={entry.id}
    >
      <div className="ca-comment-meta">
        <span className="ca-avatar">{initials(entry.actor.name)}</span>
        <span className="ca-comment-author">
          {entry.actor.name}
        </span>
        <time className="ca-comment-time" dateTime={entry.at}>
          {relative(entry.at)}
        </time>
      </div>
      <p className="ca-comment-body">
        <span className="ca-status-word">{entry.kind === 'error' ? 'error' : entry.kind === 'resolve' ? 'resolved' : 'reopened'}</span>
        {entry.note ? <span className="ca-status-note"> · {entry.note}</span> : null}
      </p>
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, (Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}
