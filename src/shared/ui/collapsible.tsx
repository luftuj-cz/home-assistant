import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

function Collapsible(props: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger(props: ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return <CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />;
}

/**
 * Opens by animating grid rows 0fr → 1fr, so the height animates without measuring. Stays mounted while closed,
 * so the closing animation can run.
 */
function CollapsibleContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      forceMount
      className={cn(
        // `grid` overrides the `hidden` attribute Radix sets while closed, so the closing animation can run;
        // visibility flips at the end of the transition and takes the closed content out of the tab order.
        "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity,visibility] duration-(--duration-slow) ease-(--ease-out)",
        "data-[state=closed]:invisible data-[state=closed]:grid-rows-[0fr] data-[state=closed]:opacity-0",
        "data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100",
        className,
      )}
      {...props}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </CollapsiblePrimitive.CollapsibleContent>
  );
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
