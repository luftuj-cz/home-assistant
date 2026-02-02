import { Container, Title, Text, Stack } from "@mantine/core";
import { useTranslation } from "react-i18next";

export function DebugPage() {
  const { t } = useTranslation();

  return (
    <Container size="xl">
      <Stack gap="xl">
        <Stack gap="xs">
          <Title order={1}>{t("debug.title")}</Title>
          <Text c="dimmed">{t("debug.description")}</Text>
        </Stack>

        <Text>
          This page is a placeholder for future developer tools and manual register inspection.
        </Text>
      </Stack>
    </Container>
  );
}
