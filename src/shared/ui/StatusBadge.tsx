import { Badge, type BadgeProps } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconRefresh, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { statusToColor, type StatusKind } from "./types";

interface StatusBadgeProps extends Omit<BadgeProps, "color" | "leftSection" | "children"> {
  status: StatusKind;
  label: ReactNode;
  icon?: ReactNode;
  showIcon?: boolean;
}

function defaultIconFor(status: StatusKind): ReactNode {
  switch (status) {
    case "success":
      return <IconCheck size={16} />;
    case "warning":
      return <IconAlertTriangle size={16} />;
    case "error":
      return <IconX size={16} />;
    default:
      return <IconRefresh size={16} className="mantine-rotate-animation" />;
  }
}

export function StatusBadge({
  status,
  label,
  icon,
  showIcon = true,
  variant = "light",
  size = "lg",
  radius = "sm",
  ...rest
}: StatusBadgeProps) {
  const leftSection = showIcon ? (icon ?? defaultIconFor(status)) : undefined;
  return (
    <Badge
      color={statusToColor(status)}
      variant={variant}
      size={size}
      radius={radius}
      leftSection={leftSection}
      {...rest}
    >
      {label}
    </Badge>
  );
}
