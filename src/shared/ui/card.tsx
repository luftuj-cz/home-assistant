import type { ComponentProps, ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import type { Tone } from "./dot";
import { ICON_STROKE, type IconComponent } from "./icon-types";

const CARD_TONE = {
  plan: "bg-plan-soft",
  manual: "shadow-[var(--shadow-plane),inset_0_0_0_1.5px_var(--manual)]",
} as const;

const ICON_TONE: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  air: "text-air",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  manual: "text-manual",
  plan: "text-plan",
};

type CardProps = ComponentProps<"section"> & {
  /** `plan`: plum tint for a running or scheduled custom plan; `manual`: orange edge for a running manual mode. */
  tone?: keyof typeof CARD_TONE;
};

/**
 * A plane holding one subject: card colour, 24px radius, a barely-there shadow and no border. Content inside sits
 * in wells; never nest a plane in a plane. Also a container, so its content can adapt to the card's own width.
 */
function Card({ className, tone, ...props }: CardProps) {
  return (
    <section
      data-slot="card"
      className={cn(
        "@container grid content-start gap-5 rounded-xl bg-card p-6 text-card-foreground shadow-plane",
        "max-[520px]:gap-4 max-[520px]:p-5",
        tone && CARD_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

type CardHeaderProps = Omit<ComponentProps<"header">, "title"> & {
  /** Context above the title: an address, a state or a count. Never repeats the title. */
  legend?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Beside the title as long as it fits (the title yields down to 96px); if it wraps, it starts at the left edge. */
  action?: ReactNode;
  icon?: IconComponent;
  iconTone?: Tone;
  /** The title's heading level: 2 for a card on a page, 3 for one under a section heading. */
  level?: 2 | 3;
};

function CardHeader({
  legend,
  title,
  description,
  action,
  icon: Icon,
  iconTone = "neutral",
  level = 2,
  className,
  ...props
}: CardHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <header
      data-slot="card-header"
      className={cn("flex flex-wrap items-center gap-3", className)}
      {...props}
    >
      {Icon && (
        <span
          className={cn(
            "grid size-10 flex-none place-items-center self-start rounded-md bg-muted",
            ICON_TONE[iconTone],
          )}
        >
          <Icon size={22} stroke={ICON_STROKE} aria-hidden />
        </span>
      )}
      <div
        data-slot="card-titles"
        className="grid min-w-0 flex-[1_1_96px] grid-cols-[minmax(0,1fr)] gap-1"
      >
        {legend && <span className="legend">{legend}</span>}
        <Heading data-slot="card-title" className="card-title">
          {title}
        </Heading>
        {description && (
          <p data-slot="card-description" className="caption text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div data-slot="card-action" className="flex flex-none items-center gap-2">
          {action}
        </div>
      )}
    </header>
  );
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3", className)}
      {...props}
    />
  );
}

/** Actions under a hairline, aligned right. */
function CardFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      data-slot="card-footer"
      className={cn("flex justify-end gap-2 border-t border-border pt-4", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardContent, CardFooter, type CardProps, type CardHeaderProps };
