import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";

export function HruDiscoveryStep() {
  const { t } = useTranslation();
  const {
    nextStep,
    prevStep,
    selectedUnit,
    setSelectedUnit,
    maxPower,
    setMaxPower,
    requiresMaxPower,
    defaultMaxPower,
    powerVariable,
    isDemoUnit,
    unitsQuery,
    saveHruMutation,
    modbusForm,
  } = useOnboardingWizard();

  async function handleSubmit() {
    if (!selectedUnit) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.error"),
        color: "red",
      });
      return;
    }
    if (requiresMaxPower && (maxPower === undefined || maxPower === null)) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.maxPowerRequired"),
        color: "red",
      });
      return;
    }

    if (isDemoUnit) {
      try {
        await saveHruMutation.mutateAsync({
          ...modbusForm.values,
          unit: selectedUnit,
          maxPower: requiresMaxPower ? maxPower : undefined,
        });
        nextStep();
      } catch {
        notifications.show({
          title: t("onboarding.mqtt.failed"),
          message: t("onboarding.unit.saveFailed"),
          color: "red",
        });
      }
      return;
    }

    nextStep();
  }

  return (
    <Stack gap="md" py="lg">
      <Text fw={500}>{t("onboarding.unit.title")}</Text>
      {unitsQuery.isLoading ? (
        <Center p="xl">
          <Loader />
        </Center>
      ) : unitsQuery.isError ? (
        <Alert color="red">{t("onboarding.unit.loadFailed")}</Alert>
      ) : (
        <Select
          label={t("onboarding.unit.modelLabel")}
          placeholder={t("onboarding.unit.modelPlaceholder")}
          data={unitsQuery.data?.map((u) => ({ value: u.id, label: u.name })) || []}
          value={selectedUnit}
          onChange={setSelectedUnit}
          searchable
        />
      )}
      <Text size="sm" c="dimmed">
        {t("onboarding.unit.hint")}
      </Text>
      {requiresMaxPower && (
        <Paper p="sm" withBorder radius="md" bg="var(--mantine-color-blue-light)">
          <Stack gap="xs">
            <Text fw={500} size="sm">
              {t("settings.hru.configuration.title")}
            </Text>
            <Text size="xs" c="dimmed">
              {t("settings.hru.configuration.maxPowerDescription")}
            </Text>
            <NumberInput
              required
              value={maxPower ?? defaultMaxPower}
              onChange={(value) => {
                const numericValue = typeof value === "number" ? value : undefined;
                setMaxPower(numericValue);
              }}
              label={t("settings.hru.configuration.maxPowerLabel")}
              description={t("settings.hru.configuration.maxPowerHint", {
                default: defaultMaxPower,
                unit:
                  typeof powerVariable?.unit === "string"
                    ? powerVariable.unit
                    : (powerVariable?.unit?.text ?? "%"),
              })}
              min={1}
              max={powerVariable?.max ?? 10000}
              size="md"
            />
          </Stack>
        </Paper>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={prevStep}>
          {t("onboarding.back")}
        </Button>
        <Button
          onClick={handleSubmit}
          loading={saveHruMutation.isPending}
          disabled={
            !selectedUnit || (requiresMaxPower && (maxPower === undefined || maxPower === null))
          }
        >
          {t("onboarding.next")}
        </Button>
      </Group>
    </Stack>
  );
}
