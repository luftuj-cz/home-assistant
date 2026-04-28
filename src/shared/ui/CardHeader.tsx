import { Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { ReactNode } from "react";
import { statusToColor, type StatusKind } from "./types";

interface CardHeaderProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: StatusKind;
  rightSection?: ReactNode;
  titleOrder?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function CardHeader({
  icon,
  title,
  description,
  status = "neutral",
  rightSection,
  titleOrder = 4,
}: CardHeaderProps) {
  const color = statusToColor(status);
  return (
    <Group justify="space-between" align="flex-start" wrap="nowrap">
      <Group gap="xs" wrap="nowrap">
        {icon && (
          <ThemeIcon color={color} variant="light" size={32} radius="md">
            {icon}
          </ThemeIcon>
        )}
        <Stack gap={0}>
          <Title order={titleOrder}>{title}</Title>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
        </Stack>
      </Group>
      {rightSection}
    </Group>
  );
}
