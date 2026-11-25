import type { CSSProperties } from "react";

import { cn } from "@luftuj/shared/utils/cn";

export type Tone = "neutral" | "air" | "success" | "warning" | "destructive" | "manual" | "plan";

const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--muted-foreground)",
  air: "var(--air)",
  success: "var(--success)",
  warning: "var(--warning)",
  destructive: "var(--destructive)",
  manual: "var(--manual)",
  plan: "var(--plan)",
};

interface DotProps {
  tone?: Tone;
  /** Only for something pending that the user waits for (a reconnect attempt, a running test). */
  pulse?: boolean;
  /** Any colour, e.g. a mode's colour; overrides `tone`. */
  color?: string;
  className?: string;
}

/** An 8px status or colour dot. Never the only carrier of meaning: put a word next to it. */
export function Dot({ tone = "neutral", pulse, color, className }: Readonly<DotProps>) {
  return (
    <span
      data-slot="dot"
      aria-hidden="true"
      style={{ "--dot": color ?? TONE_COLOR[tone] } as CSSProperties}
      className={cn(
        "relative inline-block size-2 flex-none rounded-full bg-(--dot)",
        pulse &&
          "after:absolute after:-inset-1 after:animate-ping after:rounded-full after:border-[1.5px] after:border-(--dot) after:opacity-0 after:content-['']",
        className,
      )}
    />
  );
}
