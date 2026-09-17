import { useEffect, useRef, useState } from 'react';
import { ArrowUp, CornerDownLeft, Keyboard } from 'lucide-react';
import { Hint } from './ui/tooltip';
import type { Body } from './types';

/**
 * The composer is the deliberate extension seam.
 *
 * Anything that can produce a `Body[]` can be a composer — a radio set, an
 * emoji picker, a rating, a form. Because `Body` is a discriminated union in the
 * document schema, swapping the composer changes what gets stored without
 * changing the schema or any of the pin/anchoring machinery.
 *
 * `TextComposer` below is the only one implemented, and it is a single text
 * field, per current scope.
 */
export interface ComposerProps {
  /** Existing text when editing; empty when composing fresh. */
  initial?: Body[];
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Returning an empty array is treated as "nothing to save". */
  onSubmit: (body: Body[]) => void;
  onCancel: () => void;
}

export type ComposerComponent = React.ComponentType<ComposerProps>;

export function TextComposer({
  initial,
  placeholder = 'Add a comment…',
  submitLabel = 'Comment',
  autoFocus = true,
  onSubmit,
  onCancel,
}: ComposerProps) {
  const first = initial?.find((b) => b.kind === 'text');
  const [value, setValue] = useState(first && first.kind === 'text' ? first.value : '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit([{ kind: 'text', value: trimmed }]);
  };

  return (
    <div className="ca-composer">
      <textarea
        ref={ref}
        className="ca-composer-input"
        rows={3}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits, Shift+Enter newlines — comments are often multi-line
          // and get pasted into.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            // Escape here discards the draft only. Leaving comment mode is a
            // second Escape, once no composer is open — one keystroke should
            // never cost both the draft and the mode.
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      <div className="ca-composer-actions">
        <Hint content="Enter to post · Shift+Enter for a new line">
          <span className="ca-hint" tabIndex={0} aria-label="Keyboard shortcuts">
            <Keyboard className="ca-icon" aria-hidden="true" />
            <CornerDownLeft className="ca-icon ca-icon-sm" aria-hidden="true" /> to post
          </span>
        </Hint>
        <button className="ca-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="ca-btn" onClick={submit} disabled={!value.trim()}>
          <ArrowUp className="ca-icon" aria-hidden="true" /> {submitLabel}
        </button>
      </div>
    </div>
  );
}
