import type { CSSProperties } from 'react';
import type { Box, LayerKind, Pin, TargetLayout } from './types';
import { clipPathFor } from './layout';
import { pinCount } from './cluster';

/**
 * The two overlay containers, and what goes in them.
 *
 * `document` is absolutely positioned at the document origin, so page scroll
 * moves it and all its children at once — no per-child work. `viewport` is
 * fixed, for sticky/fixed targets and anything inside an inner scroll
 * container, whose screen position moves independently of document scroll.
 *
 * Neither container takes pointer events; only the pins inside them do.
 */

export function OverlayRoot({
  layer,
  children,
}: {
  layer: LayerKind;
  children: React.ReactNode;
}) {
  return (
    <div className={`ca-layer ca-layer-${layer}`} data-anno-ignore="">
      {children}
    </div>
  );
}

function boxStyle(box: Box): CSSProperties {
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/** Hover affordance: outlines the *resolved* target and names it. */
export function TargetOutline({
  layout,
  showLabel,
}: {
  layout: TargetLayout;
  showLabel: boolean;
}) {
  if (layout.hidden) return null;
  return (
    <div
      className="ca-outline"
      style={{ ...boxStyle(layout.box), clipPath: clipPathFor(layout) }}
    >
      {showLabel && <TargetLabel label={layout.target.label} box={layout.box} />}
    </div>
  );
}

/**
 * Label chip placement, after React DevTools' `findTipPos`
 * (prior/react/packages/react-devtools-shared/.../Highlighter/Overlay.js):
 * prefer above the box, flip below when it won't fit, and clamp so it never
 * leaves the viewport. Matters for planted case 4 (a 16px target) and anything
 * near the top of the screen.
 */
function TargetLabel({ label, box }: { label: string; box: Box }) {
  const CHIP = 20;
  const flipBelow = box.top - CHIP < 4;
  return (
    <span className={`ca-chip ${flipBelow ? 'ca-chip-below' : 'ca-chip-above'}`}>{label}</span>
  );
}

export function PinButton({
  pin,
  active,
  onSelect,
}: {
  pin: Pin;
  active: boolean;
  onSelect: (pin: Pin) => void;
}) {
  if (pin.hidden) return null;

  const resolved = pin.threads.filter((t) => t.status === 'open').length === 0;
  const label =
    pin.threads.length > 1
      ? `${pin.threads.length} comment threads`
      : `${pinCount(pin)} comment${pinCount(pin) === 1 ? '' : 's'}`;

  return (
    <button
      type="button"
      className={`ca-pin${active ? ' ca-pin-active' : ''}${resolved ? ' ca-pin-resolved' : ''}`}
      style={{ top: pin.y, left: pin.x }}
      data-ca-targets={pin.threads
        .flatMap((t) => t.refs.filter((r) => r.kind === 'anno_id').map((r) => r.id))
        .join(' ')}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(pin);
      }}
    >
      {pin.threads.length > 1 ? pin.threads.length : pinCount(pin)}
    </button>
  );
}

/** Marks where a comment is being composed, before the thread exists. */
export function DraftPin({ x, y }: { x: number; y: number }) {
  return <span className="ca-pin ca-pin-draft" style={{ top: y, left: x }} />;
}
