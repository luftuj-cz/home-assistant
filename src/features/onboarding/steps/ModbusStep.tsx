import { Button, Flex, Group, NumberInput, Stack, Text, TextInput } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";

export function ModbusStep() {
  const { t } = useTranslation();
  const {
    nextStep,
    prevStep,
    modbusForm,
    testModbusMutation,
    saveHruMutation,
    selectedUnit,
    maxPower,
    requiresMaxPower,
  } = useOnboardingWizard();

  async function handleTest() {
    testModbusMutation.mutate(modbusForm.values);
  }

  async function handleSubmit() {
    const result = modbusForm.validate();
    if (result.hasErrors) return;

    if (!selectedUnit) {
      notifications.show({
        title: t("valves.alertTitle"),
        message: t("onboarding.unit.error"),
        color: "red",
      });
      return;
    }

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
  }

  return (
    <Stack gap="md" py="lg">
      <Text fw={500}>{t("onboarding.modbus.title")}</Text>
      <TextInput
        label={t("onboarding.modbus.hostLabel")}
        placeholder={t("onboarding.modbus.hostPlaceholder")}
        required
        {...modbusForm.getInputProps("host")}
      />
      <Flex direction={{ base: "column", sm: "row" }} gap="md">
        <NumberInput
          label={t("onboarding.modbus.portLabel")}
          required
          min={1}
          max={65535}
          {...modbusForm.getInputProps("port")}
          style={{ flex: 1 }}
        />
        <NumberInput
          label={t("onboarding.modbus.unitIdLabel")}
          required
          min={0}
          max={255}
          {...modbusForm.getInputProps("unitId")}
          style={{ flex: 1 }}
        />
      </Flex>
      <Group>
        <Button
          variant="light"
          size="xs"
          loading={testModbusMutation.isPending}
          onClick={handleTest}
        >
          {t("onboarding.modbus.test")}
        </Button>
        {testModbusMutation.isSuccess && (
          <Text c="green" size="sm" fw={500}>
            {t("onboarding.modbus.connected")}
          </Text>
        )}
        {testModbusMutation.isError && (
          <Text c="red" size="sm" fw={500}>
            {t("onboarding.modbus.failed")}
          </Text>
        )}
      </Group>
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={prevStep}>
          {t("onboarding.back")}
        </Button>
        <Button onClick={handleSubmit} loading={saveHruMutation.isPending}>
          {t("onboarding.next")}
        </Button>
      </Group>
    </Stack>
  );
}
