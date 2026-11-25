import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { Badge } from "./badge";
import { Dot, type Tone } from "./dot";

export type Status = "success" | "warning" | "error" | "info" | "neutral";

const TONE: Record<Status, Tone> = {
  success: "success",
  warning: "warning",
  error: "destructive",
  info: "air",
  neutral: "neutral",
};

const TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  air: "text-air",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  manual: "text-manual",
  plan: "text-plan",
};

interface StatusBadgeProps {
  status: Status;
  label: ReactNode;
  /** `dot`: a dot and a word (quieter); `pill`: a soft badge. */
  variant?: "dot" | "pill";
  className?: string;
}

/**
 * Connection or health state as a dot plus a word, never colour alone. The dot pulses only while something is
 * pending (warning, neutral); a state that is simply fine stays quiet.
 */
export function StatusBadge({
  status,
  label,
  variant = "dot",
  className,
}: Readonly<StatusBadgeProps>) {
  const tone = TONE[status];
  if (variant === "pill") {
    return (
      <Badge variant={tone === "neutral" ? "secondary" : tone} dot className={className}>
        {label}
      </Badge>
    );
  }
  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex items-center gap-2 font-sans text-[13px] leading-5 font-medium whitespace-nowrap",
        TEXT[tone],
        className,
      )}
    >
      <Dot tone={tone} pulse={status === "warning" || status === "neutral"} />
      {label}
    </span>
  );
}
