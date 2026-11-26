import type { ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { Legend } from "./legend";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Context above the title, e.g. an onboarding step or a back link. */
  legend?: ReactNode;
  /** At most two page-level actions, secondary style. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Page title, description and page actions. No page icon: the navigation already says where you are. On phones the
 * TabBar names the page, so the title is only for screen readers there (the h1 stays); the actions remain, and a
 * header with nothing else to show takes no room at all.
 */
export function PageHeader({
  title,
  description,
  legend,
  actions,
  className,
}: Readonly<PageHeaderProps>) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap items-end justify-between gap-4",
        !actions && !legend && "max-md:sr-only",
        className,
      )}
    >
      {/* A legend (onboarding step, back link) stays visible; without one the whole title block steps aside. */}
      <div className={cn("grid max-w-[640px] gap-1.5", !legend && actions && "max-md:sr-only")}>
        {legend && <Legend>{legend}</Legend>}
        <h1 className={cn("page-title", legend && "max-md:sr-only")}>{title}</h1>
        {description && <p className="lead text-muted-foreground max-md:hidden">{description}</p>}
      </div>
      {/* Phones: the actions share the row's full width evenly; a slimmer side padding lets a label such as
          "Spravovat skupiny" fit its half (on very narrow screens the longer one simply takes a little more). */}
      {actions && (
        <div className="flex gap-2 max-md:w-full max-md:*:flex-1 max-md:*:px-3">{actions}</div>
      )}
    </div>
  );
}
