import { useEffect, useRef, useState } from 'react';
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
  /** Incidental dismissal preserves this mounted composer; Cancel discards. */
  onDismiss?: () => void;
  onDraftChange?: (body: Body[]) => void;
  disabled?: boolean;
}

export type ComposerComponent = React.ComponentType<ComposerProps>;

export function TextComposer({
  initial,
  placeholder = 'Add a comment…',
  submitLabel = 'Comment',
  autoFocus = true,
  onSubmit,
  onCancel, onDismiss, onDraftChange, disabled = false,
}: ComposerProps) {
  const first = initial?.find((b) => b.kind === 'text');
  const [value, setValue] = useState(first && first.kind === 'text' ? first.value : '');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
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
        disabled={disabled}
        onChange={(e) => { setValue(e.target.value); onDraftChange?.(e.target.value.length ? [{kind:'text',value:e.target.value}] : []); }}
        onKeyDown={(e) => {
          // Enter submits, Shift+Enter newlines — comments are often multi-line
          // and get pasted into.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            // Escape minimizes without losing text when hosted by Annotations.
            // Standalone/custom hosts may retain the legacy Cancel behavior.
            e.preventDefault();
            e.stopPropagation();
            (onDismiss ?? onCancel)();
          }
        }}
      />
      <div className="ca-composer-actions">
        <span className="ca-hint ca-keyboard-hint">
          <kbd>↵</kbd> save · <kbd>⇧↵</kbd> newline
        </span>
        <button className="ca-btn-ghost" onClick={onCancel} disabled={disabled}>
          Cancel
        </button>
        <button className="ca-btn" onClick={submit} disabled={disabled || !value.trim()}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
