import { Container, Title, Text, Stack, Button, Group } from "@mantine/core";
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

        <Stack gap="xs">
          <Title order={3}>Onboarding Tools</Title>
          <Group gap="md">
            <Button
              color="red"
              variant="light"
              onClick={async () => {
                await fetch("/api/settings/onboarding-reset", { method: "POST" });
                window.location.reload();
              }}
            >
              Reset Onboarding Flag
            </Button>
            <Button
              color="green"
              variant="light"
              onClick={async () => {
                await fetch("/api/settings/onboarding-finish", { method: "POST" });
                window.location.reload();
              }}
            >
              Finish Onboarding Flag
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            This will set <code>onboarding.done</code> to <code>false</code> and reload the page,
            triggering the setup wizard.
          </Text>
        </Stack>
      </Stack>
    </Container>
  );
}
