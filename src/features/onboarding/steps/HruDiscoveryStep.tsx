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
    minPower,
    setMinPower,
    maxPower,
    setMaxPower,
    requiresMinPower,
    defaultMinPower,
    requiresMaxPower,
    defaultMaxPower,
    powerVariable,
    isDemoUnit,
    unitsQuery,
    saveHruMutation,
    modbusForm,
  } = useOnboardingWizard();

  const minPowerMissing = requiresMinPower && (minPower === undefined || minPower === null);
  const maxPowerMissing = requiresMaxPower && (maxPower === undefined || maxPower === null);
  const powerUnitLabel =
    typeof powerVariable?.unit === "string"
      ? powerVariable.unit
      : (powerVariable?.unit?.text ?? "%");

  async function handleSubmit() {
    if (!selectedUnit) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.error"),
        color: "red",
      });
      return;
    }
    if (minPowerMissing) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.minPowerRequired"),
        color: "red",
      });
      return;
    }
    if (maxPowerMissing) {
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
          minPower: requiresMinPower ? minPower : undefined,
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

  let unitSelectContent;
  if (unitsQuery.isLoading) {
    unitSelectContent = (
      <Center p="xl">
        <Loader />
      </Center>
    );
  } else if (unitsQuery.isError) {
    unitSelectContent = <Alert color="red">{t("onboarding.unit.loadFailed")}</Alert>;
  } else {
    unitSelectContent = (
      <Select
        label={t("onboarding.unit.modelLabel")}
        placeholder={t("onboarding.unit.modelPlaceholder")}
        data={unitsQuery.data?.map((u) => ({ value: u.id, label: u.name })) || []}
        value={selectedUnit}
        onChange={setSelectedUnit}
        searchable
      />
    );
  }

  return (
    <Stack gap="md" py="lg">
      <Text fw={500}>{t("onboarding.unit.title")}</Text>
      {unitSelectContent}
      <Text size="sm" c="dimmed">
        {t("onboarding.unit.hint")}
      </Text>
      {(requiresMinPower || requiresMaxPower) && (
        <Paper p="sm" withBorder radius="md" bg="var(--mantine-color-blue-light)">
          <Stack gap="xs">
            <Text fw={500} size="sm">
              {t("settings.hru.configuration.title")}
            </Text>
            <Text size="xs" c="dimmed">
              {requiresMinPower
                ? t("settings.hru.configuration.limitsDescription")
                : t("settings.hru.configuration.maxPowerDescription")}
            </Text>
            {requiresMinPower && (
              <NumberInput
                required
                value={minPower ?? defaultMinPower}
                onChange={(value) => {
                  const numericValue = typeof value === "number" ? value : undefined;
                  setMinPower(numericValue);
                }}
                label={t("settings.hru.configuration.minPowerLabel")}
                description={t("settings.hru.configuration.minPowerHint", {
                  default: defaultMinPower,
                  unit: powerUnitLabel,
                })}
                min={powerVariable?.min ?? 0}
                max={maxPower ?? powerVariable?.max ?? 10000}
                size="md"
              />
            )}
            {requiresMaxPower && (
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
                  unit: powerUnitLabel,
                })}
                min={1}
                max={powerVariable?.max ?? 10000}
                size="md"
              />
            )}
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
          disabled={!selectedUnit || minPowerMissing || maxPowerMissing}
        >
          {t("onboarding.next")}
        </Button>
      </Group>
    </Stack>
  );
}
