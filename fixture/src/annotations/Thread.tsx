import { ArrowUpLeft, CircleCheck, Reply, RotateCcw, X } from 'lucide-react';
import { Hint } from './ui/tooltip';
import { useState } from 'react';
import { useMentions } from './mentions';
import type { SubmitOptions, Body, RichSegment, LogEntry, Ref, Thread, ThreadStatus } from './types';
import type { ComposerComponent } from './Composer';
import { bodyText, logOf } from './store';

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
 * There is no delete and no edit: in a shared log every comment is visible to
 * every reader the moment it is posted, so the only lifecycle is resolve /
 * reopen. Replying to a resolved thread reopens it (the store logs the reopen
 * before the reply).
 */

export function ThreadList({
  threads,
  readOnly = false,
  Composer,
  onReply,
  onResolve,
  onReopen,
  onWiden,
  widenTo,
  unanchoredIds,
  onDismiss,
}: {
  threads: Thread[];
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
}) {
  return (
    <div className="ca-threads">
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          readOnly={readOnly}
          Composer={Composer}
          onReply={onReply}
          onResolve={onResolve}
          onReopen={onReopen}
          unanchored={unanchoredIds?.has(t.id)}
          onDismiss={threads.length === 1 ? onDismiss : undefined}
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
  readOnly = false,
  Composer,
  onReply,
  onResolve,
  onReopen,
  unanchored = false,
  onDismiss,
}: {
  thread: Thread;
  readOnly?: boolean;
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[], options?: SubmitOptions) => void | Promise<void>;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  unanchored?: boolean;
  onDismiss?: () => void;
}) {
  const { directory } = useMentions();
  const [replying, setReplying] = useState(false);
  const target = thread.refs[0];

  return (
    <article className={`ca-thread${thread.status === 'resolved' ? ' ca-thread-resolved' : ''}`} data-thread-id={thread.id}>
      <ThreadHeading target={target} status={thread.status} unanchored={unanchored} onDismiss={onDismiss} />

      <div className="ca-thread-body" tabIndex={onDismiss ? 0 : undefined} role={onDismiss ? 'region' : undefined} aria-label={onDismiss ? 'Discussion comments' : undefined}>
        {logOf(thread).map((e) => (
          <Entry key={e.id} entry={e} />
        ))}

        {thread.waitingFor && <p className="ca-waiting" role="status">Waiting for {directory?.botName ?? 'the bot'}…</p>}
        {!readOnly && (replying ? (
          <Composer
            placeholder={thread.status === 'resolved' ? 'Reply and reopen…' : 'Reply…'}
            submitLabel={thread.status === 'resolved' ? 'Reply & reopen' : 'Reply'}
            onSubmit={async (body, options) => {
              await onReply(thread.id, body, options);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div className="ca-thread-actions">
            <button className="ca-btn-ghost" onClick={() => setReplying(true)}>
              <Reply className="ca-icon" aria-hidden="true" /> Reply
            </button>
            {thread.status === 'open' ? (
              <button className="ca-btn-ghost" onClick={() => onResolve(thread.id)}>
                <CircleCheck className="ca-icon" aria-hidden="true" /> Resolve
              </button>
            ) : (
              <button className="ca-btn-ghost" onClick={() => onReopen(thread.id)}>
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
  return <Hint content={`${label} · Esc`}>
    <button type="button" className="ca-icon-button ca-close" aria-label={label} onClick={onDismiss}>
      <X className="ca-icon" aria-hidden="true" />
    </button>
  </Hint>;
}

function Entry({ entry }: { entry: LogEntry }) {
  const { directory } = useMentions();
  if (entry.kind === 'comment') {
    return (
      <div className="ca-comment" data-entry-kind="comment" data-event-id={entry.id}>
        <div className="ca-comment-meta">
          <span className="ca-avatar">{initials(entry.author.name)}</span>
          <span className="ca-comment-author">{entry.author.name}</span>
          <time className="ca-comment-time" dateTime={entry.createdAt}>
            {relative(entry.createdAt)}
          </time>
        </div>
        <p className="ca-comment-body">{entry.notifyBot&&entry.actorKind!=='bot'&&<>
          <span className="ca-mention ca-direct-badge" title="Posted directly to the bot">@{directory?.botName ??
            entry.body.flatMap(b=>b.kind==='rich'?b.content:[]).find((s): s is Extract<RichSegment, {kind:'mention'}>=>s.kind==='mention'&&s.entity==='bot')?.label ?? 'the bot'}</span>{' '}
        </>}{entry.body.map((b,i)=><span key={i}>
          {i>0?' · ':''}{b.kind==='rich'?b.content.map((s,j)=>s.kind==='mention'?<span className="ca-mention" key={j}>@{s.label}</span>:s.kind==='newline'?'\n':s.text):bodyText([b])}
        </span>)}</p>
      </div>
    );
  }
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