import { createContext, createElement, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Device defaults, not physical-keyboard detection. Layout belongs to CSS:
 * neither viewport width, pointer capabilities nor the last input event should
 * change what Enter does. UA/platform signals are intentionally heuristic.
 */
export type DeviceProfile = 'desktop' | 'mobile' | 'unknown';
export type EnterBehavior = 'send' | 'newline';

export interface DeviceCharacteristics {
  userAgent: string;
  maxTouchPoints: number;
  mobileHint?: boolean;
  platformHint?: string;
}

export interface DeviceBehaviorOverrides {
  /** An explicit host hint; auto uses the browser's low-entropy signals. */
  deviceProfile?: DeviceProfile | 'auto';
  /** For external keyboards/hybrids. Does not change other device behavior. */
  enterBehavior?: EnterBehavior | 'auto';
}

export interface DeviceBehavior {
  deviceProfile: DeviceProfile;
  enterBehavior: EnterBehavior;
  enterSends: boolean;
  showEnterShortcut: boolean;
  enterKeyHint: 'enter' | undefined;
  allowComposerFocusScroll: boolean;
  dismissOnOutsidePress: boolean;
  protectOpenPopup: boolean;
}

export function readDeviceCharacteristics(): DeviceCharacteristics {
  if (typeof navigator === 'undefined') return { userAgent: '', maxTouchPoints: 0 };
  const hints = (navigator as Navigator & {
    userAgentData?: { mobile?: boolean; platform?: string };
  }).userAgentData;
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    mobileHint: hints?.mobile,
    platformHint: hints?.platform,
  };
}

export function detectDeviceProfile(device: DeviceCharacteristics): DeviceProfile {
  const { userAgent: ua, maxTouchPoints, mobileHint, platformHint = '' } = device;
  if (mobileHint === true) return 'mobile';
  // A false mobile hint does not rule out tablets or desktop-site modes.
  if (/\b(Android|iPhone|iPad|iPod)\b/i.test(ua) || /^(Android|iOS)$/i.test(platformHint)) return 'mobile';
  // iPad Safari commonly presents a Mac UA. This is a heuristic, not proof.
  if (/\bMacintosh\b/i.test(ua) && maxTouchPoints > 1) return 'mobile';
  if (/\b(Windows|Macintosh|X11|Linux|CrOS)\b/i.test(ua)
    || /^(Windows|macOS|Linux|Chrome OS|Chromium OS)$/i.test(platformHint)) return 'desktop';
  return 'unknown';
}

export function deriveDeviceBehavior(
  device: DeviceCharacteristics,
  overrides: DeviceBehaviorOverrides = {},
): DeviceBehavior {
  const deviceProfile = overrides.deviceProfile && overrides.deviceProfile !== 'auto'
    ? overrides.deviceProfile : detectDeviceProfile(device);
  const desktop = deviceProfile === 'desktop';
  const enterBehavior = overrides.enterBehavior && overrides.enterBehavior !== 'auto'
    ? overrides.enterBehavior : desktop ? 'send' : 'newline';
  const enterSends = enterBehavior === 'send';
  return {
    deviceProfile,
    enterBehavior,
    enterSends,
    showEnterShortcut: enterSends,
    enterKeyHint: enterSends ? undefined : 'enter',
    allowComposerFocusScroll: !desktop,
    dismissOnOutsidePress: desktop,
    protectOpenPopup: !desktop,
  };
}

const DeviceBehaviorContext = createContext<DeviceBehavior | null>(null);

/** Per annotation instance; no global mutable policy or iframe host assumption. */
export function DeviceBehaviorProvider({
  overrides,
  children,
}: { overrides?: DeviceBehaviorOverrides; children: ReactNode }) {
  const [characteristics] = useState(readDeviceCharacteristics);
  const value = useMemo(
    () => deriveDeviceBehavior(characteristics, overrides),
    [characteristics, overrides?.deviceProfile, overrides?.enterBehavior],
  );
  return createElement(DeviceBehaviorContext.Provider, { value }, children);
}

/** Standalone composers get the same default resolver as a complete layer. */
export function useDeviceBehavior(): DeviceBehavior {
  const shared = useContext(DeviceBehaviorContext);
  const [fallback] = useState(() => shared ?? deriveDeviceBehavior(readDeviceCharacteristics()));
  return shared ?? fallback;
}