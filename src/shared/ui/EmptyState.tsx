import { Center, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  minHeight?: number | string;
}

export function EmptyState({ icon, title, description, action, minHeight = 180 }: EmptyStateProps) {
  return (
    <Center mih={minHeight}>
      <Stack align="center" gap="sm">
        {icon && (
          <ThemeIcon variant="light" color="gray" size={48} radius="xl">
            {icon}
          </ThemeIcon>
        )}
        <Title order={5}>{title}</Title>
        {description && (
          <Text size="sm" c="dimmed" ta="center">
            {description}
          </Text>
        )}
        {action}
      </Stack>
    </Center>
  );
}
