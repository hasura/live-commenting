import { useState } from 'react';
import type { Body, Thread } from './types';
import type { ComposerComponent } from './Composer';
import { bodyText } from './store';

/**
 * Thread popover contents: read, reply, resolve, delete.
 *
 * Reading and replying are available whether or not comment mode is on —
 * requiring authoring mode just to read a comment would be backwards.
 */

export function ThreadList({
  threads,
  Composer,
  onReply,
  onResolve,
  onReopen,
  onDeleteThread,
  onWiden,
  widenTo,
  readOnly = false, onDismiss, onDraftChange, onEditingChange,
}: {
  threads: Thread[];
  Composer: ComposerComponent;
  onReply: (threadId: string, body: Body[]) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
  onWiden?: () => void;
  widenTo?: string;
  readOnly?: boolean;
  onDismiss?: () => void;
  onDraftChange?: (body: Body[]) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const setReplying = (id: string | null) => {
    setReplyingId(id); onEditingChange?.(id !== null);
  };
  return (
    <div className="ca-threads">
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          Composer={Composer}
          readOnly={readOnly || (replyingId !== null && replyingId !== t.id)} onDismiss={onDismiss} onDraftChange={onDraftChange}
          replying={replyingId===t.id} setReplying={value=>setReplying(value?t.id:null)}
          onReply={onReply}
          onResolve={onResolve}
          onReopen={onReopen}
          onDeleteThread={onDeleteThread}
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
  onDeleteThread,
  readOnly, onDismiss, onDraftChange, replying, setReplying,
}: {
  thread: Thread;
  Composer: ComposerComponent;
  readOnly: boolean;
  onDismiss?: () => void;
  onDraftChange?: (body: Body[]) => void;
  replying: boolean;
  setReplying: (value: boolean) => void;
  onReply: (threadId: string, body: Body[]) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onDeleteThread: (threadId: string) => void;
}) {
  const target = thread.refs[0];

  return (
    <article className={`ca-thread${thread.status === 'resolved' ? ' ca-thread-resolved' : ''}`}>
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

      {thread.closedRoundId ? <p className="ca-hint">Sent review · read-only</p> : replying ? (
        <Composer
          placeholder="Reply…"
          submitLabel="Reply"
          disabled={readOnly} onDismiss={onDismiss} onDraftChange={onDraftChange}
          onSubmit={(body) => {
            if (readOnly) return;
            onReply(thread.id, body);
            onDraftChange?.([]);
            setReplying(false);
          }}
          onCancel={() => {setReplying(false); onDraftChange?.([]);}}
        />
      ) : (
        <div className="ca-thread-actions">
          <button disabled={readOnly} className="ca-btn-ghost" onClick={() => {setReplying(true);}}>
            Reply
          </button>
          {thread.status === 'open' ? (
            <button disabled={readOnly} className="ca-btn-ghost" onClick={() => onResolve(thread.id)}>
              Resolve
            </button>
          ) : (
            <button disabled={readOnly} className="ca-btn-ghost" onClick={() => onReopen(thread.id)}>
              Reopen
            </button>
          )}
          <button disabled={readOnly} className="ca-btn-ghost ca-btn-danger" onClick={() => onDeleteThread(thread.id)}>
            Delete
          </button>
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
