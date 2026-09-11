import { anno } from '../anno';

/**
 * Planted case 10 — a dense grid of small adjacent targets.
 *
 * Note the id scheme: cells compose row identity with column name
 * (`decisions.d-2.call`), which is not a hand-authored path but is still
 * semantic and unique. The annotation layer never parses it. Each cell's
 * `semantic` payload carries the row and column names so a comment on this cell
 * reads as "row 'Anchor storage', column 'Call'" in a prompt, with no DOM.
 */

interface Row {
  id: string;
  question: string;
  options: string;
  call: string;
  status: 'accepted' | 'open' | 'superseded';
}

const ROWS: Row[] = [
  {
    id: 'd-1',
    question: 'Anchor storage',
    options: 'Sidecar JSON · backend table · inline script tag',
    call: 'Sidecar JSON',
    status: 'accepted',
  },
  {
    id: 'd-2',
    question: 'Selection granularity',
    options: 'Every DOM node · renderer opt-in · heuristic',
    call: 'Renderer opt-in',
    status: 'accepted',
  },
  {
    id: 'd-3',
    question: 'Text ranges in v1',
    options: 'Ship with block · defer to v2',
    call: 'Defer to v2',
    status: 'open',
  },
];

const COLUMNS = [
  { key: 'question', label: 'Question' },
  { key: 'options', label: 'Options' },
  { key: 'call', label: 'Call' },
] as const;

export function DecisionTable() {
  return (
    <table className="decisions" {...anno('decisions', 'Decisions table', { semantic: { kind: 'figure' } })}>
      <thead>
        <tr>
          {COLUMNS.map((c) => (
            <th key={c.key}>{c.label}</th>
          ))}
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => (
          <tr key={r.id} {...anno(`decisions.${r.id}`, `Decision: ${r.question}`, { semantic: { kind: 'row', row: r.question } })}>
            {COLUMNS.map((c) => (
              <td
                key={c.key}
                {...anno(`decisions.${r.id}.${c.key}`, `${r.question} → ${c.label}`, { semantic: { kind: 'cell', row: r.question,
                  column: c.label,
                  value: r[c.key] } })}
              >
                {r[c.key]}
              </td>
            ))}
            <td
              {...anno(`decisions.${r.id}.status`, `${r.question} → Status`, { semantic: { kind: 'cell', row: r.question,
                column: 'Status',
                value: r.status } })}
            >
              <span className={`pill pill-${r.status}`}>{r.status}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
