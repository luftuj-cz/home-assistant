import { Alert, Button, Group, Loader, Stack, Text, ThemeIcon } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useOnboardingWizard } from "../hooks/useOnboardingWizard";
import { IconCheck, IconX } from "@tabler/icons-react";

export function StatusStep() {
  const { t } = useTranslation();
  const { prevStep, statusQuery, finishMutation, nextStep } = useOnboardingWizard();

  async function handleFinish() {
    try {
      await finishMutation.mutateAsync();
      nextStep();
    } catch {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.errors.finishFailed"),
        color: "red",
      });
    }
  }

  return (
    <Stack gap="lg" py="xl" align="center">
      {statusQuery.isLoading ? (
        <Loader size="lg" />
      ) : (
        <>
          <Group>
            <ThemeIcon
              size={42}
              radius="xl"
              color={statusQuery.data?.luftatorAvailable ? "green" : "orange"}
              variant="light"
            >
              {statusQuery.data?.luftatorAvailable ? <IconCheck size={20} /> : <IconX size={20} />}
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={700} size="lg">
                {statusQuery.data?.luftatorAvailable
                  ? t("onboarding.status.found")
                  : t("onboarding.status.notFound")}
              </Text>
              <Text c="dimmed" size="sm">
                {t("onboarding.status.integrationStatus")}
              </Text>
            </Stack>
          </Group>

          {!statusQuery.data?.luftatorAvailable && (
            <Alert color="orange" title={t("onboarding.status.waitingTitle")} maw={500}>
              {t("onboarding.status.waitingHA")}
            </Alert>
          )}
          {statusQuery.data?.luftatorAvailable && (
            <Alert color="green" title={t("onboarding.status.readyTitle")} maw={500}>
              {t("onboarding.status.ready")}
            </Alert>
          )}
        </>
      )}
      <Group justify="center" mt="xl">
        <Button variant="default" onClick={prevStep}>
          {t("onboarding.back")}
        </Button>
        <Button size="lg" onClick={handleFinish} loading={finishMutation.isPending}>
          {t("onboarding.status.dashboard")}
        </Button>
      </Group>
    </Stack>
  );
}
