import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import type { Tone } from "./dot";

const TONE: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  air: "text-air",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  manual: "text-manual",
  plan: "text-plan",
};

type LegendProps = ComponentProps<"span"> & { tone?: Tone };

/**
 * The mono uppercase label above every live value, well and scale ("VÝKON", "PŘÍVOD"). Over a plane title it adds
 * context only (an address, a state, a count); it never repeats the title.
 */
export function Legend({ tone = "neutral", className, ...props }: LegendProps) {
  return <span data-slot="legend" className={cn("legend", TONE[tone], className)} {...props} />;
}
