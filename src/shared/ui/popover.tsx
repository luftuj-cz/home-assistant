import { Popover as PopoverPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

/**
 * A floating plane for pickers. Radix flips it above the trigger when the room below is short, so opening it never
 * grows or scrolls the page.
 */
function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  collisionPadding = 16,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 grid grid-cols-[minmax(0,1fr)] rounded-lg bg-popover p-1.5 font-sans text-sm leading-5 text-popover-foreground",
          "shadow-[var(--shadow-float),0_0_0_1px_var(--border)] outline-none",
          "origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-menu-in",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
