import type { ComponentProps, ReactElement, ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

/**
 * shadcn/ui Tooltip (Radix variant), adapted to the library's scoped CSS.
 * Source: ui.shadcn.com/r/styles/new-york-v4/tooltip.json
 * No Tailwind/global theme dependency for apps embedding this library.
 */
export function TooltipProvider(props: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={250} {...props} />;
}
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export function TooltipContent({ children, className = '', sideOffset = 6, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      className={`ca-tooltip ${className}`}
      data-slot="tooltip-content"
      data-anno-ignore=""
      data-anno-preserve-draft=""
      sideOffset={sideOffset}
      collisionPadding={8}
      {...props}
    >
      {children}
      <TooltipPrimitive.Arrow className="ca-tooltip-arrow" width={8} height={4} />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>;
}

/** Disabled controls remain inspectable by pointer and keyboard in debug mode. */
export function Hint({ content, children, disabled = false }: { content: ReactNode; children: ReactElement; disabled?: boolean }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      {disabled
        ? <span className="ca-tooltip-trigger" tabIndex={0} aria-label={typeof content === 'string' ? content : undefined}>{children}</span>
        : children}
    </TooltipTrigger>
    <TooltipContent side="top">{content}</TooltipContent>
  </Tooltip>;
}