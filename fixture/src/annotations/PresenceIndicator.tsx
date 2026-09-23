import { useId, useRef, useState } from 'react';
import {
  arrow, autoUpdate, flip, FloatingArrow, FloatingPortal, offset, safePolygon,
  shift, size, useClick, useDismiss, useFloating, useFocus, useHover, useInteractions,
} from '@floating-ui/react';
import { Users } from 'lucide-react';

/** Host-supplied current viewers, not the bot's participant/mention directory. */
export type ViewerPresence = { count: number; viewers: string[] };

/** Hover/focus previews; click/tap latches until an outside press or Escape.
 * Pure presentation: the host owns presence collection and refreshes.
 */
export function PresenceIndicator({ presence }: { presence: ViewerPresence | null }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);
  const panelId = useId();
  const titleId = useId();
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open,
    onOpenChange(next, _event, reason) {
      if (next && reason === 'click') setPinned(true);
      if (!next) {
        // Moving the pointer/focus away is not an explicit dismissal after a click.
        if (pinned && (reason === 'hover' || reason === 'focus')) return;
        setPinned(false);
      }
      setOpen(next);
    },
    placement: 'top-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.setProperty('--ca-presence-height', `${Math.max(0, availableHeight)}px`);
          elements.floating.style.setProperty('--ca-presence-width', `${Math.max(0, availableWidth)}px`);
        },
      }),
      arrow({ element: arrowRef, padding: 12 }),
    ],
  });
  const hover = useHover(context, {
    mouseOnly: true,
    // Match Radix hints: no added exit delay once outside the safe corridor.
    // Keep the corridor and click-pinned behavior; opening timing is unchanged.
    delay: { close: 0 },
    handleClose: safePolygon({ blockPointerEvents: false }),
  });
  const focus = useFocus(context);
  // Do not toggle: clicking an already-hovered (or pinned) bubble keeps it open.
  const click = useClick(context, { toggle: false });
  const dismiss = useDismiss(context, {
    outsidePressEvent: 'pointerdown',
    capture: { escapeKey: true, outsidePress: true },
    bubbles: { escapeKey: false, outsidePress: false },
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss]);

  return <>
    <button
      ref={refs.setReference}
      type="button"
      className="ca-tool ca-presence"
      data-testid="presence"
      data-anno-ignore=""
      data-anno-preserve-draft=""
      {...getReferenceProps({
        'aria-label': presence ? `${presence.count} viewing now` : 'Viewing now — local preview',
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
      })}
    >
      <Users className="ca-icon" aria-hidden="true" />
      <span>{presence?.count ?? 0}</span>
    </button>
    {open && <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}
        className="ca-presence-bubble"
        data-testid="presence-bubble"
        data-anno-ignore=""
        data-anno-preserve-draft=""
        data-pinned={pinned ? 'true' : 'false'}
        {...getFloatingProps({
          id: panelId,
          role: 'region',
          'aria-labelledby': titleId,
          tabIndex: -1,
        })}
      >
        <div className="ca-presence-heading" id={titleId}>Viewing now</div>
        <div className="ca-presence-scroll" tabIndex={0}>
          {presence?.viewers.length ? <ul className="ca-presence-list">
            {presence.viewers.map((name, index) => <li key={index}>
              <span className="ca-presence-dot" aria-hidden="true" />
              <span>{name}</span>
            </li>)}
          </ul> : <p className="ca-presence-empty">
            {presence ? 'No current viewers.' : 'Local preview — live presence is unavailable.'}
          </p>}
        </div>
        <FloatingArrow ref={arrowRef} context={context} width={14} height={7}
          fill="#fff" stroke="#e2e8f0" strokeWidth={1} aria-hidden="true" />
      </div>
    </FloatingPortal>}
  </>;
}