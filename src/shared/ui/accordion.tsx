import { IconChevronDown } from "@tabler/icons-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE } from "./icon-types";

/** Rows that open in place, divided by hairlines. Settings sections use SettingsSection instead. */
function Accordion(props: ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border last:border-b-0", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/trigger flex flex-1 cursor-pointer items-center justify-between gap-4 py-4 text-left font-sans text-sm leading-5 font-medium",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45",
          className,
        )}
        {...props}
      >
        {children}
        <IconChevronDown
          size={16}
          stroke={ICON_STROKE}
          aria-hidden
          className="pointer-events-none flex-none text-muted-foreground transition-transform duration-(--duration-base) group-data-[state=open]/trigger:rotate-180"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      forceMount
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] font-sans text-sm leading-5",
        "transition-[grid-template-rows,opacity,visibility] duration-(--duration-slow) ease-(--ease-out)",
        "data-[state=closed]:invisible data-[state=closed]:grid-rows-[0fr] data-[state=closed]:opacity-0",
        "data-[state=open]:grid-rows-[1fr] data-[state=open]:opacity-100",
      )}
      {...props}
    >
      <div className="min-h-0 overflow-hidden">
        <div className={cn("pb-4", className)}>{children}</div>
      </div>
    </AccordionPrimitive.Content>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
