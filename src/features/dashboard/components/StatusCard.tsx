import { Card } from "@mantine/core";
import { IconNetwork, IconServer } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { BaseCard, CardHeader, StatusBadge, type StatusKind } from "@luftuj/shared/ui";

interface StatusCardProps {
  title: string;
  description: string;
  status: StatusKind;
  statusLabel: string;
  icon?: ReactNode;
  children?: ReactNode;
}

export function StatusCard({
  title,
  description,
  status,
  statusLabel,
  icon,
  children,
}: StatusCardProps) {
  const defaultIcon =
    icon ??
    (title.toLowerCase().includes("modbus") ? <IconNetwork size={18} /> : <IconServer size={18} />);

  return (
    <BaseCard>
      <CardHeader
        icon={defaultIcon}
        title={title}
        description={description}
        status={status}
        rightSection={<StatusBadge status={status} label={statusLabel} />}
      />
      {children && (
        <Card.Section withBorder inheritPadding mt="md" p="md">
          {children}
        </Card.Section>
      )}
    </BaseCard>
  );
}
