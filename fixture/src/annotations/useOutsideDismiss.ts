import { useEffect, useRef, type RefObject } from 'react';
import { useDeviceBehavior } from './device';

/** Outside presses dismiss desktop popups, never mobile/unknown popups.
 * Explicit pin/toolbar actions retain their own switching/toggling behavior.
 */
export function useOutsideDismiss(
  panel: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  triggerSelector?: string,
) {
  const { dismissOnOutsidePress } = useDeviceBehavior();
  const dismiss=useRef(onDismiss);
  dismiss.current=onDismiss;
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      // Pointer type and resizing never change the device interaction policy.
      if (!dismissOnOutsidePress) return;
      const node = panel.current;
      if (!node || (event.target instanceof Node && node.contains(event.target))) return;
      if (event.target instanceof Element) {
        if (event.target.closest('.ca-pin,[data-anno-preserve-draft]')) return;
        if (triggerSelector && event.target.closest(triggerSelector)) return;
      }
      dismiss.current();
    };
    // Ignore the pointer sequence that opened the popup.
    const id = window.setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [panel, triggerSelector, dismissOnOutsidePress]);
}
