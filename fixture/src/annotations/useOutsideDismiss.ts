import { useEffect, type RefObject } from 'react';
import { isMobileViewport } from './viewport';

/** Outside presses dismiss desktop popups, never mobile sheets.
 * Explicit pin/toolbar actions retain their own switching/toggling behavior.
 */
export function useOutsideDismiss(
  panel: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  triggerSelector?: string,
) {
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      // Check at event time too: resizing must not leave a stale dismissal policy.
      if (isMobileViewport()) return;
      const node = panel.current;
      if (!node || (event.target instanceof Node && node.contains(event.target))) return;
      if (event.target instanceof Element) {
        if (event.target.closest('.ca-pin,[data-anno-preserve-draft]')) return;
        if (triggerSelector && event.target.closest(triggerSelector)) return;
      }
      onDismiss();
    };
    // Ignore the pointer sequence that opened the popup.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [panel, onDismiss, triggerSelector]);
}