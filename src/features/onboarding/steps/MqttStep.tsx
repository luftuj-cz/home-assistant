import { useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { Alert } from "@luftuj/shared/ui/alert";
import { ConnectionTest, type ConnectionTestState } from "@luftuj/shared/ui/connection-test";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Switch } from "@luftuj/shared/ui/switch";
import { ApiResponseError, translateApiError } from "@luftuj/shared/utils/apiError";

/**
 * MQTT (optional): the broker for Home Assistant discovery. Switched off, the amber warning takes the form's place.
 * The connection test uses what is typed, before anything is saved.
 */
export function MqttStep() {
  const { t } = useTranslation();
  const { nextStep, mqttForm, saveMqttMutation, testMqttMutation, isDemoUnit } =
    useOnboardingWizard();
  const [saveFailed, setSaveFailed] = useState(false);
  const {
    control,
    register,
    watch,
    getValues,
    handleSubmit,
    reset,
    formState: { errors },
  } = mqttForm;
  const enabled = watch("enabled");
  const host = watch("host");
  const port = watch("port");

  let testState: ConnectionTestState = "idle";
  if (testMqttMutation.isPending) testState = "testing";
  else if (testMqttMutation.isSuccess) testState = "success";
  else if (testMqttMutation.isError) testState = "error";

  const submit = handleSubmit(async (values) => {
    setSaveFailed(false);
    try {
      await saveMqttMutation.mutateAsync(values);
      // A demo unit starts the next pass through the wizard from a clean MQTT form.
      if (isDemoUnit) reset();
      nextStep();
    } catch {
      setSaveFailed(true);
    }
  });

  return (
    <StepFrame
      title={t("onboarding.mqtt.title")}
      optional
      onNext={() => void submit()}
      busy={saveMqttMutation.isPending}
    >
      <Controller
        control={control}
        name="enabled"
        render={({ field }) => (
          <Switch
            label={t("onboarding.mqtt.enable")}
            description={t("onboarding.mqtt.enableDescription")}
            checked={field.value}
            onCheckedChange={(checked) => {
              field.onChange(checked);
              testMqttMutation.reset();
            }}
          />
        )}
      />
      {enabled ? (
        <>
          <div className="grid grid-cols-6 gap-4 @max-[520px]:grid-cols-[minmax(0,1fr)]">
            <Field
              label={t("onboarding.mqtt.hostLabel")}
              required
              error={errors.host?.message}
              className="col-span-4 @max-[520px]:col-span-1"
            >
              <Input
                {...register("host", { onChange: () => testMqttMutation.reset() })}
                placeholder={t("onboarding.mqtt.hostPlaceholder")}
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t("onboarding.mqtt.portLabel")}
              required
              error={errors.port?.message}
              className="col-span-2 @max-[520px]:col-span-1"
            >
              <Controller
                control={control}
                name="port"
                render={({ field }) => (
                  <NumberInput
                    value={field.value ?? null}
                    min={1}
                    max={65535}
                    onValueChange={(value) => {
                      field.onChange(value);
                      testMqttMutation.reset();
                    }}
                  />
                )}
              />
            </Field>
            <Field
              label={t("onboarding.mqtt.userLabel")}
              className="col-span-3 @max-[520px]:col-span-1"
            >
              <Input
                {...register("user", { onChange: () => testMqttMutation.reset() })}
                placeholder={t("app.nav.optional")}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t("onboarding.mqtt.passLabel")}
              className="col-span-3 @max-[520px]:col-span-1"
            >
              <Input
                {...register("password", { onChange: () => testMqttMutation.reset() })}
                type="password"
                placeholder={t("app.nav.optional")}
                autoComplete="new-password"
              />
            </Field>
          </div>
          <ConnectionTest
            state={testState}
            onTest={() => testMqttMutation.mutate(getValues())}
            disabled={!host?.trim()}
            detail={`${host ?? ""}:${port ?? ""}`}
            error={
              testMqttMutation.isError ? translateApiError(testMqttMutation.error, t) : undefined
            }
            code={
              testMqttMutation.error instanceof ApiResponseError
                ? testMqttMutation.error.code
                : undefined
            }
          />
        </>
      ) : (
        <Alert variant="warning" title={t("valves.warningTitle")}>
          {t("onboarding.mqtt.warning")}
        </Alert>
      )}
      {saveFailed && <Alert variant="destructive">{t("onboarding.errors.mqttSaveFailed")}</Alert>}
    </StepFrame>
  );
}
