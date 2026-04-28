import { Center, Loader, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

interface LoadingStateProps {
  label?: ReactNode;
  minHeight?: number | string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

export function LoadingState({ label, minHeight = 180, size = "md" }: LoadingStateProps) {
  return (
    <Center mih={minHeight}>
      <Stack align="center" gap="xs">
        <Loader size={size} />
        {label && (
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  );
}
