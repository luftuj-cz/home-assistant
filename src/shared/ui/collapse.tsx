import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Opens and closes its content by animating grid rows 0fr → 1fr, so the height animates without measuring. Closed
 * content is inert. The inner box bleeds 20px vertically and 12px sideways so shadows and focus rings are not
 * clipped; the bleed lets clicks through to the elements around it. Keep page padding at 16px or more.
 */
export function Collapse({ open, children, className }: Readonly<CollapseProps>) {
  return (
    <div
      data-slot="collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={open ? undefined : true}
      inert={!open}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-(--duration-slow) ease-(--ease-out)",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="pointer-events-none -mx-3 -my-5 min-h-0 overflow-hidden px-3 py-5 [&>*]:pointer-events-auto">
        {children}
      </div>
    </div>
  );
}
