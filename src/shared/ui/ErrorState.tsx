import { Center, Code, Group, Stack, Text, ThemeIcon, Title, UnstyledButton } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconAlertTriangle, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface ErrorStateProps {
  title: ReactNode;
  description?: ReactNode;
  detail?: string;
  detailLabel?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  minHeight?: number | string;
}

export function ErrorState({
  title,
  description,
  detail,
  detailLabel,
  icon = <IconAlertTriangle size={28} />,
  action,
  minHeight = 180,
}: Readonly<ErrorStateProps>) {
  const [detailOpen, { toggle: toggleDetail }] = useDisclosure(false);

  return (
    <Center mih={minHeight} p="md">
      <Stack align="center" gap="sm" maw={480}>
        <ThemeIcon variant="light" color="red" size={56} radius="xl">
          {icon}
        </ThemeIcon>
        <Title order={4} ta="center">
          {title}
        </Title>
        {description && (
          <Text size="sm" c="dimmed" ta="center">
            {description}
          </Text>
        )}
        {action}
        {detail && (
          <Stack gap={4} w="100%">
            <UnstyledButton onClick={toggleDetail} aria-expanded={detailOpen}>
              <Group gap={4} justify="center">
                {detailOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                <Text size="xs" c="dimmed">
                  {detailLabel}
                </Text>
              </Group>
            </UnstyledButton>
            {detailOpen && (
              <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {detail}
              </Code>
            )}
          </Stack>
        )}
      </Stack>
    </Center>
  );
}
