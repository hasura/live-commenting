import { useState } from 'react';
import type { Body, Thread } from './types';
import type { ComposerComponent } from './Composer';
import { bodyText } from './store';

/**
 * Thread popover contents: read, reply, resolve, reopen.
 *
 * Reading and replying are available whether or not comment mode is on —
 * requiring authoring mode just to read a comment would be backwards.
 *
 * There is no delete and no edit: in a shared log every comment is visible to
 * every reader the moment it is posted, so the only lifecycle is resolve /
 * reopen. A thread resolved by the owning bot says so inline and can be
 * reopened by any reviewer.
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
  const resolution = thread.status === 'resolved' ? thread.resolution : undefined;

  return (
    <article className={`ca-thread${thread.status === 'resolved' ? ' ca-thread-resolved' : ''}`} data-thread-id={thread.id}>
      <header className="ca-thread-head">
        <span className="ca-thread-target" title={target?.id}>
          {target?.label ?? target?.id ?? 'unknown target'}
        </span>
        {thread.status === 'resolved' && <span className="ca-tag">resolved</span>}
      </header>

      {thread.comments.map((c) => (
        <div key={c.id} className="ca-comment">
          <div className="ca-comment-meta">
            <span className="ca-avatar">{initials(c.author.name)}</span>
            <span className="ca-comment-author">{c.author.name}</span>
            <time className="ca-comment-time" dateTime={c.createdAt}>
              {relative(c.createdAt)}
            </time>
          </div>
          <p className="ca-comment-body">{bodyText(c.body)}</p>
        </div>
      ))}

      {resolution && (
        <p className={`ca-resolution${resolution.actorKind === 'bot' ? ' ca-resolution-bot' : ''}`}>
          ✓ Resolved by {resolution.actor.name}
          {resolution.actorKind === 'bot' ? ' (bot)' : ''} ·{' '}
          <time dateTime={resolution.at}>{relative(resolution.at)}</time>
          {resolution.note ? ` · ${resolution.note}` : ''}
        </p>
      )}

      {replying ? (
        <Composer
          placeholder="Reply…"
          submitLabel="Reply"
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