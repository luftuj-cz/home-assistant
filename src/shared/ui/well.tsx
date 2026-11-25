import type { ComponentProps, ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { Legend } from "./legend";

type WellProps = ComponentProps<"div"> & { legend?: ReactNode };

/** Content inside a plane: a muted fill, 16px radius, 16px padding. Never nest a plane in a plane; nest wells. */
export function Well({ legend, className, children, ...props }: WellProps) {
  return (
    <div
      data-slot="well"
      className={cn("grid min-w-0 content-start gap-2 rounded-lg bg-muted p-4", className)}
      {...props}
    >
      {legend && <Legend>{legend}</Legend>}
      {children}
    </div>
  );
}
