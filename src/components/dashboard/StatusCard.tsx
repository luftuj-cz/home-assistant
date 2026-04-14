import { Badge, Card, Group, Stack, Text, Title, ThemeIcon } from "@mantine/core";
import {
  IconCheck,
  IconAlertTriangle,
  IconX,
  IconRefresh,
  IconServer,
  IconNetwork,
} from "@tabler/icons-react";
import type { ReactNode } from "react";

interface StatusCardProps {
  title: string;
  description: string;
  status: "success" | "warning" | "error" | "neutral";
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
  const color =
    status === "success"
      ? "green"
      : status === "warning"
        ? "yellow"
        : status === "error"
          ? "red"
          : "gray";

  const statusIcon =
    status === "success" ? (
      <IconCheck size={20} />
    ) : status === "warning" ? (
      <IconAlertTriangle size={20} />
    ) : status === "error" ? (
      <IconX size={20} />
    ) : (
      <IconRefresh size={20} className="mantine-rotate-animation" />
    );

  const defaultIcon =
    icon ??
    (title.toLowerCase().includes("modbus") ? <IconNetwork size={18} /> : <IconServer size={18} />);

  return (
    <Card shadow="sm" p="lg" withBorder radius="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="xs">
          <ThemeIcon color={color} variant="light" size={32} radius="md">
            {defaultIcon}
          </ThemeIcon>
          <Stack gap={0}>
            <Title order={4}>{title}</Title>
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          </Stack>
        </Group>
        <Badge color={color} variant="light" size="lg" radius="sm" leftSection={statusIcon}>
          {statusLabel}
        </Badge>
      </Group>

      {children && (
        <Card.Section withBorder inheritPadding mt="md" p="md">
          {children}
        </Card.Section>
      )}
    </Card>
  );
}
