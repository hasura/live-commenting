/**
 * The planted hit-test cases.
 *
 * The fixture is a realistic document, not a test grid — but the hard cases are
 * deliberately placed where they'd naturally occur. This registry is the map, so
 * you can find them without reading every component. Dev-only; not part of the
 * artefact.
 */

export interface PlantedCase {
  n: number;
  title: string;
  /** Elements to flash, by `data-anno-id`. */
  targets: string[];
  /** What this case breaks if the layer gets it wrong. */
  breaks: string;
  /** Cases I expect to actually bite. */
  key?: boolean;
}

export const PLANTED_CASES: PlantedCase[] = [
  {
    n: 1,
    key: true,
    title: 'Zero-gap fill — child exactly fills parent',
    targets: ['wireframe.msg.m2', 'wireframe.msg.m2.body'],
    breaks:
      'The card has no padding, so the body\'s rect is identical to the card\'s. ' +
      'Nearest-ancestor hit-testing can never reach the card. This is the case ' +
      'that forces the breadcrumb widen path to exist.',
  },
  {
    n: 2,
    title: 'Boundary-hugging siblings — 0px gap, shared edge',
    targets: [
      'wireframe.msg.m1.react.up',
      'wireframe.msg.m1.react.down',
      'wireframe.msg.m1.react.reply',
    ],
    breaks:
      'Buttons share a 1px border (negative margin). Off-by-one in hit-testing, ' +
      'and two 2px outlines land on the same pixel line.',
  },
  {
    n: 3,
    key: true,
    title: 'Overflow badge — child visually outside its parent',
    targets: ['wireframe.msg.m1.react.up', 'wireframe.msg.m1.react.up.count'],
    breaks:
      'The count badge is absolutely positioned outside the button\'s box. DOM ' +
      'ancestry and visual containment disagree: closest() says child-of, the ' +
      'rect says outside. Any rect-containment shortcut breaks here.',
  },
  {
    n: 4,
    title: 'Target smaller than the pin',
    targets: ['doc.header.menu'],
    breaks:
      'A 16px icon button with a 24px pin. Pin placement and collision have no ' +
      'room; naive centering puts the pin over its own target.',
  },
  {
    n: 5,
    key: true,
    title: 'Inline annotatable inside prose',
    targets: ['spec.summary.body', 'spec.summary.token', 'spec.summary.link'],
    breaks:
      'A mode="block" <code> and an inline button live inside a mode="text" ' +
      'paragraph. Decides whether text and element mode can coexist: what should ' +
      'happen when a text selection crosses a block target?',
  },
  {
    n: 6,
    key: true,
    title: 'Nested scroll container',
    targets: ['wireframe.threads'],
    breaks:
      'The thread list scrolls inside the panel. Pins must clip to the inner ' +
      'container, not the viewport. The dev overlay below is deliberately naive ' +
      'about this — scroll the list and watch outlines escape the panel. That ' +
      'escape is the bug the real layer has to fix.',
  },
  {
    n: 7,
    title: 'Sticky header',
    targets: ['doc.header'],
    breaks:
      'Sticky positioning means the element\'s document offset and its viewport ' +
      'rect diverge as you scroll. A pin computed once from document coords ' +
      'detaches.',
  },
  {
    n: 8,
    title: 'Conditional mount',
    targets: ['doc.header.menu'],
    breaks:
      'Open the ⋯ menu; its items are annotatable. A comment anchored to a menu ' +
      'item points at something not currently in the DOM. Hidden, or orphaned? ' +
      'A policy question, not a bug — but it needs an answer.',
  },
  {
    n: 9,
    key: true,
    title: 'Keyed list reorder',
    targets: ['wireframe.panel.sort'],
    breaks:
      'Toggle the sort order. Ids derive from message identity (m1/m2/m3), so ' +
      'comments must stay with their message. Had ids derived from list position ' +
      'every comment would silently relocate — the trap this case exists to catch.',
  },
  {
    n: 10,
    title: 'Dense grid of small adjacent targets',
    targets: ['decisions.d-1.call', 'decisions.d-2.call', 'decisions.d-3.call'],
    breaks:
      'Table cells, ids composed from row identity + column name. Many small ' +
      'neighbours: hover flicker, and pins that overlap adjacent cells.',
  },
];
