import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

/** A placeholder while first data loads. Size it like the real content so nothing jumps when it arrives. */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("h-4 w-full animate-skeleton rounded-sm bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
