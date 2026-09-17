import { useEffect, useState } from 'react';

// Keep this boundary identical to the mobile sheet media query in annotations.css.
const MOBILE_QUERY = '(width < 480px)';

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(isMobileViewport);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}