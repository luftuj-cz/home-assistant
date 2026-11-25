import { IconPlugConnectedX, IconRefresh } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";
import { ICON_STROKE, type IconComponent } from "./icon-types";

interface ErrorStateProps {
  title: ReactNode;
  /** A human sentence: what failed, in the user's terms. */
  description?: ReactNode;
  /** The raw code, second ("ECONNREFUSED 192.168.1.40:502"). */
  details?: string;
  /** Shows a retry button. */
  onRetry?: () => void;
  retryLabel?: ReactNode;
  /** Replaces the unplugged icon (e.g. a 404). */
  icon?: IconComponent;
  /** Another action after the retry button, e.g. "Domů". */
  action?: ReactNode;
  className?: string;
}

/** A section failed to load: the human sentence first, then the code in mono, then a retry. */
export function ErrorState({
  title,
  description,
  details,
  onRetry,
  retryLabel,
  icon: Icon = IconPlugConnectedX,
  action,
  className,
}: Readonly<ErrorStateProps>) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "grid justify-items-center gap-2 rounded-lg bg-muted px-6 py-8 text-center",
        className,
      )}
    >
      <span className="mb-2 grid size-[52px] place-items-center rounded-full bg-card text-destructive">
        <Icon size={24} stroke={ICON_STROKE} aria-hidden />
      </span>
      <p className="card-title">{title}</p>
      {description && (
        <p className="body mb-2 max-w-[380px] text-muted-foreground">{description}</p>
      )}
      {details && (
        <code className="code mb-2 rounded-sm bg-card px-2.5 py-1 break-all">{details}</code>
      )}
      {(onRetry || action) && (
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button variant="secondary" icon={IconRefresh} onClick={onRetry}>
              {retryLabel ?? t("ui.retry")}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
