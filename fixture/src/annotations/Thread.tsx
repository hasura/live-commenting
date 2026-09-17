import { ArrowUpLeft, CircleCheck, Reply, RotateCcw, X } from 'lucide-react';
import { Hint } from './ui/tooltip';
import { useState } from 'react';
import type { Body, LogEntry, Ref, Thread, ThreadStatus } from './types';
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
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[]) => void;
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
  Composer,
  onReply,
  onResolve,
  onReopen,
  unanchored = false,
  onDismiss,
}: {
  thread: Thread;
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[]) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  unanchored?: boolean;
  onDismiss?: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const target = thread.refs[0];

  return (
    <article className={`ca-thread${thread.status === 'resolved' ? ' ca-thread-resolved' : ''}`} data-thread-id={thread.id}>
      <ThreadHeading target={target} status={thread.status} unanchored={unanchored} onDismiss={onDismiss} />

      {logOf(thread).map((e) => (
        <Entry key={e.id} entry={e} />
      ))}

      {replying ? (
        <Composer
          placeholder={thread.status === 'resolved' ? 'Reply and reopen…' : 'Reply…'}
          submitLabel={thread.status === 'resolved' ? 'Reply & reopen' : 'Reply'}
          onSubmit={(body) => {
            onReply(thread.id, body);
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
      )}
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
    <Hint content={`${state} · ${target?.id ?? 'Unknown target'}`}>
      <span className="ca-thread-target" tabIndex={0}>
        <span className="ca-thread-label">{target?.label ?? target?.id ?? 'Unknown target'}</span>
      </span>
    </Hint>
    {status === 'resolved' && <span className="ca-tag">resolved</span>}
    {unanchored && <span className="ca-tag ca-tag-unanchored">unanchored</span>}
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
  if (entry.kind === 'comment') {
    return (
      <div className="ca-comment" data-entry-kind="comment">
        <div className="ca-comment-meta">
          <span className="ca-avatar">{initials(entry.author.name)}</span>
          <span className="ca-comment-author">{entry.author.name}</span>
          <time className="ca-comment-time" dateTime={entry.createdAt}>
            {relative(entry.createdAt)}
          </time>
        </div>
        <p className="ca-comment-body">{bodyText(entry.body)}</p>
      </div>
    );
  }
  const bot = entry.actorKind === 'bot';
  return (
    <div
      className={`ca-comment ca-status ca-status-${entry.kind}${bot ? ' ca-resolution-bot' : ''}${entry.kind === 'resolve' ? ' ca-resolution' : ''}`}
      data-entry-kind={entry.kind}
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
        <span className="ca-status-word">{entry.kind === 'resolve' ? 'resolved' : 'reopened'}</span>
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