import { useState } from 'react';
import type { Body, LogEntry, Thread } from './types';
import type { ComposerComponent } from './Composer';
import { bodyText, logOf } from './store';

/**
 * Thread popover contents: the thread's log, then reply / resolve / reopen.
 *
 * The log is rendered as one conversation: comments, resolves and reopens in
 * the order they happened, each with the same avatar · name · time row. A
 * resolve or reopen is a message whose body is the status word in small caps,
 * so it reads as part of the conversation rather than a marker stuck to the
 * end. The thread's *effective* state (`status`) still drives the header tag,
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
}: {
  threads: Thread[];
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[]) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onWiden?: () => void;
  widenTo?: string;
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
        />
      ))}
      {onWiden && widenTo && (
        <button className="ca-widen" onClick={onWiden}>
          ↑ Widen to <b>{widenTo}</b>
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
}: {
  thread: Thread;
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[]) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
}) {
  const [replying, setReplying] = useState(false);
  const target = thread.refs[0];

  return (
    <article className={`ca-thread${thread.status === 'resolved' ? ' ca-thread-resolved' : ''}`} data-thread-id={thread.id}>
      <header className="ca-thread-head">
        <span className="ca-thread-target" title={target?.id}>
          {target?.label ?? target?.id ?? 'unknown target'}
        </span>
        {thread.status === 'resolved' && <span className="ca-tag">resolved</span>}
      </header>

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
            Reply
          </button>
          {thread.status === 'open' ? (
            <button className="ca-btn-ghost" onClick={() => onResolve(thread.id)}>
              Resolve
            </button>
          ) : (
            <button className="ca-btn-ghost" onClick={() => onReopen(thread.id)}>
              Reopen
            </button>
          )}
        </div>
      )}
    </article>
  );
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
          {bot ? ' (bot)' : ''}
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