import { IconX } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, useSonner, type ToasterProps } from "sonner";

import { useTheme } from "@luftuj/shared/theme/useTheme";
import { useMediaQuery } from "@luftuj/shared/utils/useMediaQuery";
import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";
import { Spinner } from "./spinner";

export type ToastVariant =
  | "info"
  | "success"
  | "warning"
  | "destructive"
  | "manual"
  | "plan"
  | "neutral";

const MARK: Record<ToastVariant, string> = {
  info: "bg-air",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  manual: "bg-manual",
  plan: "bg-plan",
  neutral: "bg-muted-foreground",
};

export const VISIBLE_TOASTS = 3;

interface ToastProps {
  variant?: ToastVariant;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Work still in progress: a spinner in place of the colour mark. */
  loading?: boolean;
  /** `false` hides the close button. */
  dismissible?: boolean;
  onClose?: () => void;
}

/** A transient result: a 4px colour mark at the left edge instead of a tinted background or glow. */
export function Toast({
  variant = "info",
  title,
  description,
  action,
  loading,
  dismissible = true,
  onClose,
}: Readonly<ToastProps>) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="toast"
      data-variant={variant}
      className="flex w-[min(400px,calc(100vw-32px))] max-w-full items-center gap-3 rounded-lg bg-popover py-3 pr-3 pl-4 font-sans text-popover-foreground shadow-float"
    >
      {loading ? (
        <Spinner size={16} className="self-start pt-0.5" />
      ) : (
        <span
          aria-hidden="true"
          className={cn("w-1 flex-none self-stretch rounded-[2px]", MARK[variant])}
        />
      )}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="label">{title}</p>
        {description && <div className="caption text-muted-foreground">{description}</div>}
      </div>
      {action}
      {dismissible && (
        <Button
          variant="ghost"
          size="icon-sm"
          icon={IconX}
          aria-label={t("ui.close")}
          onClick={onClose}
        />
      )}
    </div>
  );
}

/** "+{n} další" under the stack when more than three toasts wait. */
function HiddenCount({ position }: Readonly<{ position: ToasterProps["position"] }>) {
  const { t } = useTranslation();
  const { toasts } = useSonner();
  const hidden = toasts.length - VISIBLE_TOASTS;
  if (hidden <= 0) {
    return null;
  }
  return (
    <span
      aria-live="polite"
      className={cn(
        "caption pointer-events-none fixed bottom-1 z-[999999999] text-muted-foreground",
        position === "bottom-center" ? "left-1/2 -translate-x-1/2" : "left-7",
      )}
    >
      {t("ui.moreToasts", { count: hidden })}
    </span>
  );
}

/**
 * Where toasts appear: bottom-left on desktop, bottom-centre on a phone; three visible, the rest counted.
 * Errors stay until closed; everything else closes after 5 s. Hovering pauses the timers. Call notify().
 */
export function Toaster(props: Readonly<ToasterProps>) {
  const { t } = useTranslation();
  const { colorScheme } = useTheme();
  const phone = useMediaQuery("(max-width: 767px)");
  const position = phone ? "bottom-center" : "bottom-left";

  return (
    <>
      <Sonner
        theme={colorScheme}
        position={position}
        visibleToasts={VISIBLE_TOASTS}
        expand
        gap={8}
        // On a phone the stack sits above the floating TabBar (64px + 12px inset + safe area).
        offset={phone ? { bottom: 104 } : 24}
        mobileOffset={{ bottom: 104 }}
        containerAriaLabel={t("app.notificationsRegion")}
        // Toasts are 400px wide on desktop (sonner's default is 356px); on a phone sonner spans the width.
        style={{ "--width": "400px" } as CSSProperties}
        {...props}
      />
      <HiddenCount position={position} />
    </>
  );
}
