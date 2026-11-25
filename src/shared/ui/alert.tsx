import {
  IconAlertTriangle,
  IconBolt,
  IconCalendarEvent,
  IconCheck,
  IconInfoCircle,
} from "@tabler/icons-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE, type IconComponent } from "./icon-types";

type AlertVariant = "info" | "success" | "warning" | "destructive" | "plan" | "manual";

const VARIANT: Record<AlertVariant, { box: string; accent: string; icon: IconComponent }> = {
  info: { box: "bg-air-soft", accent: "text-air", icon: IconInfoCircle },
  success: { box: "bg-success-soft", accent: "text-success", icon: IconCheck },
  warning: { box: "bg-warning-soft", accent: "text-warning", icon: IconAlertTriangle },
  destructive: {
    box: "bg-destructive-soft",
    accent: "text-destructive",
    icon: IconAlertTriangle,
  },
  plan: { box: "bg-plan-soft", accent: "text-plan", icon: IconCalendarEvent },
  manual: { box: "bg-manual-soft", accent: "text-manual", icon: IconBolt },
};

type AlertProps = Omit<ComponentProps<"div">, "title"> & {
  variant?: AlertVariant;
  title?: ReactNode;
  /** Replaces the variant's default icon. */
  icon?: IconComponent;
  /** A button on the right, vertically centred. */
  action?: ReactNode;
};

/**
 * Inline page or section message: a soft fill, no border, an icon and title in the variant's colour.
 * `destructive` is announced right away (role=alert); the rest politely (role=status).
 */
function Alert({
  variant = "info",
  title,
  icon,
  action,
  children,
  className,
  ...props
}: AlertProps) {
  const v = VARIANT[variant];
  const Icon = icon ?? v.icon;
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(
        "flex animate-fade items-start gap-3 rounded-lg px-4 py-3.5 text-foreground",
        v.box,
        className,
      )}
      {...props}
    >
      <Icon size={20} stroke={ICON_STROKE} className={cn("flex-none", v.accent)} aria-hidden />
      <div className="body grid flex-1 gap-0.5">
        {title && <p className={cn("font-semibold", v.accent)}>{title}</p>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="self-center">{action}</div>}
    </div>
  );
}

export { Alert, type AlertProps, type AlertVariant };
