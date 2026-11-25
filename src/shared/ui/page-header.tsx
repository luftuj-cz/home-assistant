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

/** Page title, description and page actions. No page icon: the navigation already says where you are. */
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
      className={cn("flex flex-wrap items-end justify-between gap-4", className)}
    >
      <div className="grid max-w-[640px] gap-1.5">
        {legend && <Legend>{legend}</Legend>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="lead text-muted-foreground max-md:hidden">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
