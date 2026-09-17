# v4 review — separate layout from input policy

**Status: proposal for review; no behavior changes applied.**  
September 17, 2026 · audited `a9a66c6` on `v4`.

All prior implementation was already committed at the start of this review. The live fixture remains unchanged. This document and the isolated audit script are a documentation/test increment, not a new runtime release.

## Recommendation

Keep **two independent dimensions**, not one `isMobile` flag:

- **Layout:** `compactLayout = viewport width < 480 CSS px`, measured inside the artifact. A narrow desktop artifact viewer should use the bottom sheet.
- **Interaction defaults:** a stable `deviceProfile = mobile | desktop | unknown`, independent of width. Derive an explicit `enterBehavior = newline | send`; allow an override for external keyboards and hybrid devices.

**Desktop:** Enter sends, Shift+Enter inserts a newline, at every width.  
**Phone/tablet:** Enter inserts a newline; Comment/Reply sends, at every width.

The Comment/Reply button remains available in both modes. Keep IME composition protection. Resizing, rotating, clicking with a different pointer, or showing the keyboard must not silently change what Enter does.

### How to distinguish the second dimension

There is **no reliable, cross-browser web API that tells us whether this Enter came from a physical or onscreen keyboard**. Device detection can provide sensible defaults, not certainty about the keyboard in use.

Recommended practical resolver, kept in one small helper:

1. Accept an **explicit integration/device-profile override** when supplied. The current skill has no host device-profile bridge; do not assume PromptQL already passes one into its iframe.
2. Otherwise use **low-entropy browser/platform signals**:
   - A positive `navigator.userAgentData?.mobile` is a mobile signal where supported. A false value is not sufficient evidence of a desktop: inspect the OS/device family as well.
   - Recognize iPhone/iPad/iPod and Android phones/tablets from the UA. Recognize the common iPad desktop-UA case using a Mac-like UA plus multiple touch points.
   - Recognize Windows/macOS/Linux desktop UAs only after the mobile/tablet checks. A Windows touchscreen laptop remains desktop; touch support alone must not switch its Enter behavior.
   - Treat unrecognized/ambiguous environments as **unknown**; default Enter to newline rather than risk an unintended send.
3. Provide an explicit **“Enter sends” preference or composer configuration override**, separate from the device profile. An iPad with an external keyboard can opt into desktop shortcuts without changing its layout, outside-dismiss behavior, or focus-scrolling policy.

This is a deliberately limited **heuristic**, including the Mac-UA + touch iPad test. UA spoofing, desktop-site modes, unusual devices, and custom embedded webviews can defeat it. Do not present it as verified hardware detection. No high-entropy fingerprinting is needed.

**Do not use these as keyboard detectors:**

| Signal | What it actually tells us | Why not use it for Enter? |
|---|---|---|
| Viewport width / orientation | Available layout space | A desktop iframe can be 375px; a phone can be wider than 480px. |
| `pointer: coarse`, `hover: none`, `any-pointer`, `any-hover` | Pointer capabilities | W3C explicitly says these cannot detect keyboards. |
| `navigator.maxTouchPoints` alone | Touch capability | Touchscreen laptops still have desktop keyboards. |
| Last pointer event | Mouse, pen, or touch for that event | A touch does not mean the user stopped using a physical keyboard. |
| `KeyboardEvent.code` / existence of `keydown` | Keyboard event information | Virtual and accessibility inputs can emit physical-looking codes. |
| `enterkeyhint` | Requested label/icon on a virtual Return key | It changes neither detection nor the handler's send/newline semantics. |
| `userAgentData.mobile` alone | A browser's mobile signal | Limited browser support, and tablet/desktop-site caveats. |

## Audit — which current branches should move?

Paths below are under `fixture/src`. Line numbers describe the audited commit, not a stable API.

| Behavior | Current implementation | Recommendation |
|---|---|---|
| Sheet versus anchor-positioned bubble / fixed unanchored tray | `annotations/annotations.css:345–355`, `<480px` | **Keep width.** Phone in a wide viewport gets the wide layout; narrow desktop gets the sheet. |
| Full width, 2px side/bottom gaps, maximum 80% viewport height | Same CSS block | **Keep geometry.** No device gate. The limit is not proof of keyboard avoidance in an iframe. |
| Hide toolbar while a popup exists; restore it on close | `annotations.css:347`, `<480px` and actual popup presence | **Keep width.** This belongs to the space-saving sheet layout. |
| Action-row placement/wrapping | `annotations.css:273–275,345–346` | **Keep layout/content-based.** A narrow desktop must still show the shortcut hint; wrap it if necessary. Hint presence is determined by Enter policy, not width. |
| Compact toolbar padding, gap, font and minimum control height | `annotations.css:209–212`, `≤700px` | **Keep width.** This is a separate existing density rule, not another definition of a mobile device. |
| Toolbar wrapping and popup/inspector clearance | Toolbar flex layout; `Annotations.tsx:621–634,690–697`; `dev/DevOverlay.tsx:37–43,97` | **Keep measured geometry.** Continue observing the actual toolbar height. |
| Enter sends versus newline | `annotations/Composer.tsx:71`, width lookup at keydown | **Move to Enter policy.** Desktop sends even below 480px; mobile inserts newline even above 480px. |
| Enter-to-post icon, text and tooltip | `Composer.tsx:85`, width-driven render | **Move with Enter policy.** Show iff Enter sends. Never advertise a shortcut the handler will not perform. |
| `enterKeyHint="enter"` | `Composer.tsx:66`, width-driven attribute | **Move with Enter policy.** Request `enter` in newline mode; keep current desktop omission in send mode. This is a hint, not behavior. |
| Composer focus allows scrolling versus `preventScroll:true` | `Composer.tsx:45–49`, width lookup when autofocus runs | **Move to mobile-platform policy, not Enter override.** Native focus scrolling for phone/tablet at any width; retain desktop no-scroll behavior. Unknown: favor ordinary focus. Autofocus itself remains universal. |
| Outside click/tap dismisses popup | `annotations/useOutsideDismiss.ts:15`, width lookup at pointerdown | **Recommend device interaction policy.** Desktop dismisses at every width; mobile preserves at every width. This preserves the stated desktop/mobile interaction rule rather than tying it to sheet appearance. |
| Outside annotation click/drag cannot replace an open popup | `Annotations.tsx:115,235,259` | **Move together with outside-dismiss policy.** Otherwise a mobile popup can survive the outside-dismiss handler but be replaced by a new draft. |
| Draft/reply preservation across resizing | Same mounted popup/composer; tested transitions | **Keep universal.** Layout changes do not reset text, refocus, or alter send semantics. |

The current helper `annotations/viewport.ts` only calls `matchMedia('(width < 480px)')`. Rename it to a layout-specific name when implementing; it does **not** detect a mobile device.

### Outside-dismiss is a separate review choice

The table recommends a device-based policy because the original requirement said desktop clicks dismiss and mobile taps do not. That yields:

- Narrow desktop: bottom sheet, hidden toolbar, outside click dismisses.
- Wide mobile/tablet: wide popup, visible toolbar, outside tap does not dismiss.
- Explicit Close/Cancel and switching to another pin keep working in both.
- Guarding annotation creation does not make the whole document inert or stop unrelated links from working.

An alternative is **sheet versus floating-popup behavior**, leaving dismissal width-based; another is reacting to `PointerEvent.pointerType` per press. Both are valid product choices, but neither is equivalent to the stated device rule. Do not silently adopt either when decoupling Enter.

### Things that should not acquire a mobile gate

- Autofocus when starting a new comment or reply.
- Explicit Close/Cancel, Escape handling, and mutually exclusive popup switching.
- IME safety, comment/reply/status semantics, history persistence and sync.
- Shared thread cards, 14px labels, resolved/unanchored badges, colors and Lucide icons.
- Debug toolbar controls and temporary hidden annotation targets.
- General reduced-motion handling: respect the user's media preference, not device classification.

The inherited bubble/unanchored focus differences are **not desktop-versus-mobile branches**. Bubble manages opening/return focus, wraps Tab, and has dialog semantics; the unanchored tray does not. Keyboard Hide comments can leave the bubble open while hiding the tray. These remain separate unresolved review items; do not hide them inside this change.

## Expected result after approval

| Scenario | Layout | Enter | Shortcut hint | Outside press | Composer autofocus scrolling |
|---|---|---|---|---|---|
| Desktop, 375px viewer | Bottom sheet; toolbar hidden while open | Send | Shown, fitting/wrapping | Dismiss | Suppressed, as desktop today |
| Desktop, 1024px viewer | Existing wide layout | Send | Shown | Dismiss | Suppressed |
| Phone, 375px | Bottom sheet; toolbar hidden while open | Newline | Hidden | Keep open | Allowed |
| Phone landscape, 844px | Existing wide layout | Newline | Hidden | Keep open | Allowed |
| iPad, 1024px, onscreen keyboard | Existing wide layout | Newline | Hidden | Keep open | Allowed |
| Windows touchscreen laptop, 375px | Bottom sheet; toolbar hidden while open | Send | Shown | Dismiss | Suppressed |
| iPad plus hardware keyboard, explicit “Enter sends” override | Width-based | Send | Shown | Keep mobile policy | Keep mobile policy |

**Default for a mobile device with an external keyboard:** still newline/button-send. The browser does not reliably tell us it was attached. The explicit preference is the escape hatch; do not guess from a keydown or a mouse connection.

## Ground-truth evidence

- Source: full `e1f4e80..a9a66c6` v4 diff plus every `matchMedia`, width/media, focus, pointer, and Enter gate in `fixture/src`.
- Script: `fixture/scripts/audit-layout-input.mjs` probes both popup types under six viewport/UA/touch profiles.
- It launches an isolated Vite development host on port 5182 and uses separate browser localStorage. It never touches production comments.
- **Chromium emulation is not an iPhone, iPad, real keyboard, or Safari compatibility test.** The UA versions are synthetic profiles, not the user's installed iOS version.
- Current source has no device-profile detection. The probe is intended to expose the current coupling, not validate a proposed classifier.
- **All 12 profile/popup combinations passed the current-behavior assertions, with no browser exceptions.** Both popup types behaved identically on the audited width gates.

### What the browser probe found today

| Emulated profile | Width | Enter today | Outside press today | Autofocus today |
|---|---:|---|---|---|
| Desktop, narrow viewer | 375px | newline | Keep open | native scrolling |
| Desktop, wide viewer | 1024px | send | Dismiss | preventScroll:true |
| iPhone profile, narrow | 375px | newline | Keep open | native scrolling |
| iPhone profile, wide | 844px | send | Dismiss | preventScroll:true |
| iPad desktop-UA profile, wide | 1024px | send | Dismiss | preventScroll:true |
| Windows touchscreen profile, narrow | 375px | newline | Keep open | native scrolling |

A desktop profile at 375px currently loses Enter-to-send. A phone or tablet profile above 480px currently gains it. That is the coupling this proposal removes.

- Prior keyboard obstruction research remains separate. Akshaya tests inside the PromptQL artifact viewer; no parent-frame bridge or viewport workaround is part of this proposal.
- Runtime code, `SPEC.md` implementation contract, live build ID, service, and saved comments remain unchanged by this review.

After implementation, acceptance tests should cross **layout × profile × popup type**, not just shrink the browser window. Include 479/480 boundaries, resizing with unsent text, mobile orientation, desktop narrow iframe, tablet UA cases, IME, and the external-keyboard override. Validate real iPhone/iPad behavior in the artifact viewer separately.

## Primary sources (researched via Exa)

1. [W3C Media Queries Level 4 — interaction features](https://www.w3.org/TR/mediaqueries-4/#mf-interaction): pointer/hover cannot detect keyboards.
2. [MDN KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code): nonphysical input can emit physical-looking codes.
3. [MDN NavigatorUAData.mobile](https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/mobile): mobile hint and limited availability.
4. [MDN UA detection guidance](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent): limitations, alternatives and responsive layout guidance.
5. [WebKit — desktop-class browsing on iPad](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/): iPad can use the Mac UA and supports hardware keyboards.
6. [MDN maxTouchPoints](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints): touch capability, not device category.
7. [MDN PointerEvent.pointerType](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pointerType): the source of a pointer event.
8. [MDN enterkeyhint](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/enterkeyhint): virtual-key label/icon only.

## Decisions requested

1. Approve separating width-based layout from device-default Enter behavior, with a configurable Enter-sends override for hybrid/external-keyboard cases.
2. Approve moving **outside-dismiss + annotation replacement protection** and **composer scrolling policy** off width too.
3. Keep the unrelated bubble/tray focus and Hide comments differences out of this patch.