import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { IconDamper } from "./icons";
import { ICON_STROKE, type IconComponent } from "./icon-types";

interface EmptyStateProps {
  icon?: IconComponent;
  title: ReactNode;
  description?: ReactNode;
  /** The next step, usually a button. */
  action?: ReactNode;
  className?: string;
}

/** Explains an empty list and the next step: a muted well with a round icon disc. */
export function EmptyState({
  icon: Icon = IconDamper,
  title,
  description,
  action,
  className,
}: Readonly<EmptyStateProps>) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "grid justify-items-center gap-2 rounded-lg bg-muted px-6 py-8 text-center",
        className,
      )}
    >
      <span className="mb-2 grid size-[52px] place-items-center rounded-full bg-card text-muted-foreground">
        <Icon size={24} stroke={ICON_STROKE} aria-hidden />
      </span>
      <p className="card-title">{title}</p>
      {description && (
        <p className="body mb-2 max-w-[380px] text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
