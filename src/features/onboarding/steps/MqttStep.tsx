import {
  Alert,
  Button,
  Flex,
  Group,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";

export function MqttStep() {
  const { t } = useTranslation();
  const { nextStep, prevStep, mqttForm, mqttMutation, testMqttMutation, isDemoUnit } =
    useOnboardingWizard();

  async function handleSubmit() {
    const result = mqttForm.validate();
    if (result.hasErrors) return;

    try {
      await mqttMutation.mutateAsync(mqttForm.values);
      if (isDemoUnit) {
        mqttForm.reset();
        nextStep();
      } else {
        nextStep();
      }
    } catch {
      notifications.show({
        title: t("onboarding.mqtt.failed"),
        message: t("onboarding.errors.mqttSaveFailed"),
        color: "red",
      });
    }
  }

  return (
    <Stack gap="md" py="lg">
      <Group justify="space-between">
        <Text fw={500}>{t("onboarding.mqtt.title")}</Text>
        <Switch
          label={t("onboarding.mqtt.enable")}
          {...mqttForm.getInputProps("enabled", { type: "checkbox" })}
        />
      </Group>

      {mqttForm.values.enabled && (
        <>
          <Flex direction={{ base: "column", sm: "row" }} gap="md">
            <TextInput
              label={t("onboarding.mqtt.hostLabel")}
              placeholder={t("onboarding.mqtt.hostPlaceholder")}
              required
              {...mqttForm.getInputProps("host")}
              style={{ flex: 1 }}
            />
            <NumberInput
              label={t("onboarding.mqtt.portLabel")}
              required
              min={1}
              max={65535}
              {...mqttForm.getInputProps("port")}
              style={{ flex: 1 }}
            />
          </Flex>
          <Flex direction={{ base: "column", sm: "row" }} gap="md">
            <TextInput
              label={t("onboarding.mqtt.userLabel")}
              placeholder={t("app.nav.optional")}
              {...mqttForm.getInputProps("user")}
              style={{ flex: 1 }}
            />
            <PasswordInput
              label={t("onboarding.mqtt.passLabel")}
              placeholder={t("app.nav.optional")}
              {...mqttForm.getInputProps("password")}
              style={{ flex: 1 }}
            />
          </Flex>
          <Group>
            <Button
              variant="light"
              size="xs"
              loading={testMqttMutation.isPending}
              onClick={() => testMqttMutation.mutate(mqttForm.values)}
            >
              {t("onboarding.mqtt.test")}
            </Button>
            {testMqttMutation.isSuccess && (
              <Text c="green" size="sm" fw={500}>
                {t("onboarding.mqtt.connected")}
              </Text>
            )}
            {testMqttMutation.isError && (
              <Text c="red" size="sm" fw={500}>
                {t("onboarding.mqtt.failed")}
              </Text>
            )}
          </Group>
        </>
      )}
      {!mqttForm.values.enabled && (
        <Alert color="yellow" title={t("valves.warningTitle")}>
          {t("onboarding.mqtt.warning")}
        </Alert>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={prevStep}>
          {t("onboarding.back")}
        </Button>
        <Button onClick={handleSubmit} loading={mqttMutation.isPending}>
          {t("onboarding.next")}
        </Button>
      </Group>
    </Stack>
  );
}
