import { useState } from 'react';
import { anno, annoText } from '../anno';

/**
 * A live HTML mock of a comment panel, embedded in the spec that describes it.
 *
 * This is the dense end of the fixture. Planted cases 1, 2, 3, 6 and 9 live
 * here. The nesting is tight on purpose, but it is the nesting you get from
 * writing this UI normally — nothing is contrived to be pathological.
 */

interface Message {
  id: string;
  author: string;
  initials: string;
  time: string;
  body: string;
  up: number;
}

const MESSAGES: Message[] = [
  {
    id: 'm1',
    author: 'Ada Okonjo',
    initials: 'AO',
    time: '2h',
    body: 'The pin covers the element it points at when the target is small. Can we offset it outside the bounds?',
    up: 2,
  },
  {
    id: 'm2',
    author: 'Ravi Menon',
    initials: 'RM',
    time: '4h',
    body: 'Agreed. And clicking anywhere in this card selects the body, never the card itself.',
    up: 0,
  },
  {
    id: 'm3',
    author: 'Jun Park',
    initials: 'JP',
    time: '1d',
    body: 'Reordering the list must not move comments. Ids come from message identity, so it should hold.',
    up: 1,
  },
];

export function Wireframe() {
  const [newestFirst, setNewestFirst] = useState(true);
  const ordered = newestFirst ? MESSAGES : [...MESSAGES].reverse();

  return (
    <div className="frame" {...anno('wireframe.panel', 'Comment panel wireframe', { semantic: { kind: 'figure' } })}>
      {/* ---- panel head ------------------------------------------------- */}
      <div className="panel-head" {...anno('wireframe.panel.head', 'Panel header', { semantic: { kind: 'section' } })}>
        <span className="panel-title">Comments</span>
        <span
          className="pill"
          {...anno('wireframe.panel.count', 'Open comment count', { semantic: { kind: 'status', value: MESSAGES.length } })}
        >
          {MESSAGES.length}
        </span>
        {/* CASE 9 — reorder must not move comments */}
        <button
          className="ghost-btn"
          onClick={() => setNewestFirst((v) => !v)}
          {...anno('wireframe.panel.sort', 'Sort order toggle', { semantic: { kind: 'action', state: newestFirst ? 'newest-first' : 'oldest-first' } })}
        >
          {newestFirst ? 'Newest' : 'Oldest'} ↕
        </button>
      </div>

      {/* ---- CASE 6 — nested scroll container --------------------------- */}
      <div className="thread-list" {...anno('wireframe.threads', 'Comment thread list', { semantic: { kind: 'section' } })}>
        {ordered.map((m) => (
          <Msg key={m.id} m={m} />
        ))}
      </div>

      {/* ---- composer; Send sits flush against the panel edge ----------- */}
      <div className="composer" {...anno('wireframe.composer', 'Comment composer', { semantic: { kind: 'section' } })}>
        <textarea
          className="composer-input"
          rows={2}
          placeholder="Add a comment…"
          {...anno('wireframe.composer.input', 'Comment text input', { semantic: { kind: 'input' } })}
        />
        <button
          className="send-btn"
          {...anno('wireframe.composer.send', 'Send comment', { semantic: { kind: 'action' } })}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function Msg({ m }: { m: Message }) {
  return (
    /* CASE 1 — the card has no padding, so .msg-body's rect is identical to
       the card's. Nearest-ancestor resolution can never land on the card. */
    <article
      className="msg"
      {...anno(`wireframe.msg.${m.id}`, `Comment by ${m.author}`, { semantic: { kind: 'message', author: m.author } })}
    >
      <div
        className="msg-body"
        {...anno(`wireframe.msg.${m.id}.body`, `Body of ${m.author}'s comment`, { semantic: { kind: 'message-body' } })}
      >
        <header className="msg-head">
          <span className="avatar" aria-hidden="true">{m.initials}</span>
          <span className="msg-author">{m.author}</span>
          <span className="msg-time">· {m.time}</span>
        </header>

        <p {...annoText(`wireframe.msg.${m.id}.text`, `Text of ${m.author}'s comment`, { kind: 'prose' })}>
          {m.body}
        </p>

        {/* CASE 2 — zero gap, buttons share a 1px border via negative margin */}
        <div
          className="reactions"
          {...anno(`wireframe.msg.${m.id}.react`, 'Reactions', { semantic: { kind: 'section' } })}
        >
          <button
            className="react-btn"
            {...anno(`wireframe.msg.${m.id}.react.up`, 'Thumbs up', { semantic: { kind: 'action', value: m.up } })}
          >
            👍
            {/* CASE 3 — badge is positioned outside the button's own box */}
            {m.up > 0 && (
              <span
                className="count-badge"
                {...anno(`wireframe.msg.${m.id}.react.up.count`, 'Thumbs up count', { semantic: { kind: 'status', value: m.up } })}
              >
                {m.up}
              </span>
            )}
          </button>
          <button
            className="react-btn"
            {...anno(`wireframe.msg.${m.id}.react.down`, 'Thumbs down', { semantic: { kind: 'action' } })}
          >
            👎
          </button>
          <button
            className="react-btn"
            {...anno(`wireframe.msg.${m.id}.react.reply`, 'Reply', { semantic: { kind: 'action' } })}
          >
            Reply
          </button>
        </div>
      </div>
    </article>
  );
}
