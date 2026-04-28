import { Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface FormSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  gap?: number | string;
}

export function FormSection({ title, description, children, gap = "md" }: FormSectionProps) {
  return (
    <Stack gap={gap}>
      {title && <Title order={5}>{title}</Title>}
      {description && (
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      )}
      {children}
    </Stack>
  );
}
