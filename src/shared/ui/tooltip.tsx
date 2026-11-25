import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

/** Mounted once at the app root. */
function TooltipProvider({
  delayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = ComponentProps<typeof TooltipPrimitive.Content> & {
  /** Wrap long text at 240px in the sans face; the default is one mono line (ids, names). */
  wrap?: boolean;
};

/** The full text of a truncated name or an icon button's label, on an ink surface. */
function TooltipContent({
  className,
  sideOffset = 8,
  wrap,
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-sm bg-primary px-2.5 py-1.5 text-primary-foreground shadow-float",
          "origin-(--radix-tooltip-content-transform-origin) animate-tooltip-in",
          wrap
            ? "w-60 font-sans text-xs leading-4"
            : "font-mono text-xs leading-4 whitespace-nowrap",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
