import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

/** Peer views inside a page, underline style with an `air` underline on the active tab. */
function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("grid gap-4", className)} {...props} />;
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // The hairline is an inset shadow, so the active tab's underline paints over it without a negative margin
        // (a -1px margin overflowed the list by a pixel and made it scroll vertically). On narrow screens the list
        // scrolls sideways, without a visible scrollbar.
        "flex gap-6 overflow-x-auto overflow-y-hidden overscroll-x-contain shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-2 border-b-2 border-transparent py-2.5",
        "font-sans text-sm leading-5 font-medium whitespace-nowrap text-muted-foreground",
        "transition-[color,border-color] duration-(--duration-fast) hover:text-foreground",
        "data-[state=active]:border-air data-[state=active]:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("min-w-0 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
