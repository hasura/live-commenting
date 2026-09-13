import { useEffect, useState } from 'react';

/** Insets the host reserves around generated content, in CSS pixels. */
export interface ReviewInsets { top: number; bottom: number }
export interface ReviewStatus {
  state: 'idle' | 'unsent' | 'sending' | 'sent' | 'error' | 'uncertain';
  pendingCount?: number;
  /** The host owns delivery, authorization and idempotency. */
  onSend: () => void;
  disabled?: boolean;
  message?: string;
}

function viewport() {
  const v = window.visualViewport;
  const width = v?.width ?? window.innerWidth;
  const height = v?.height ?? window.innerHeight;
  return {
    width, height, left: v?.offsetLeft ?? 0, top: v?.offsetTop ?? 0,
    bottom: Math.max(0, window.innerHeight - height - (v?.offsetTop ?? 0)),
    compact: width <= 700 || height <= 480,
  };
}

/** One batched listener set per review shell, never one listener per marker. */
export function useReviewViewport() {
  const [value, setValue] = useState(viewport);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = viewport();
        setValue(old => Object.keys(next).every(k => old[k as keyof typeof old] === next[k as keyof typeof next]) ? old : next);
      });
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  return value;
}

export function useElementHeight(element: HTMLElement | null) {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!element) { setHeight(0); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHeight(Math.ceil(element.getBoundingClientRect().height)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [element]);
  return height;
}
