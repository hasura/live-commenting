import type { CSSProperties } from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle, OctagonX, X } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** shadcn/ui Sonner wrapper, with scoped styles instead of a global theme. */
export function Toaster(props: ToasterProps) {
  return <Sonner
    theme="light"
    position="top-right"
    closeButton
    visibleToasts={5}
    duration={8000}
    className="ca-toaster"
    icons={{
      success: <CircleCheck size={16} />,
      info: <Info size={16} />,
      warning: <CircleAlert size={16} />,
      error: <OctagonX size={16} />,
      loading: <LoaderCircle size={16} className="ca-spin" />,
      close: <X size={14} />,
    }}
    style={{
      '--normal-bg': '#ffffff',
      '--normal-text': '#0f172a',
      '--normal-border': '#e2e8f0',
      '--border-radius': '8px',
      zIndex: 2147483300,
    } as CSSProperties}
    toastOptions={{ classNames: { toast: 'review-toast', description: 'ca-toast-description', actionButton: 'ca-toast-action' } }}
    {...props}
  />;
}