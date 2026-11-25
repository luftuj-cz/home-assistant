import { useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import {
  hruTestValues,
  testHruConnection,
  type HruTestResult,
} from "@luftuj/features/settings/hruTest";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import { Alert } from "@luftuj/shared/ui/alert";
import { ConnectionTest, type ConnectionTestState } from "@luftuj/shared/ui/connection-test";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { ApiResponseError, translateApiError } from "@luftuj/shared/utils/apiError";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("ModbusStep");

/**
 * Modbus TCP: host, port and unit id in mono, and a connection test that reads the unit's live values with what is
 * typed (the same `/api/hru/test` Nastavení uses). Další saves the unit with its address.
 */
export function ModbusStep() {
  const { t } = useTranslation();
  const temperature = useTemperature();
  const {
    nextStep,
    modbusForm,
    saveHruMutation,
    selectedUnit,
    selectedUnitDef,
    minPower,
    maxPower,
    requiresMinPower,
    requiresMaxPower,
  } = useOnboardingWizard();
  const {
    control,
    register,
    watch,
    getValues,
    handleSubmit,
    formState: { errors },
  } = modbusForm;
  const [test, setTest] = useState<ConnectionTestState>("idle");
  const [testResult, setTestResult] = useState<HruTestResult | null>(null);
  const [testError, setTestError] = useState<{ message: string; code?: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const host = watch("host");
  const port = watch("port");

  function limits() {
    return {
      minPower: requiresMinPower ? minPower : undefined,
      maxPower: requiresMaxPower ? maxPower : undefined,
    };
  }

  function resetTest() {
    setTest("idle");
    setTestResult(null);
    setTestError(null);
  }

  async function runTest() {
    if (!selectedUnit) return;
    resetTest();
    setTest("testing");
    try {
      setTestResult(await testHruConnection({ ...getValues(), unit: selectedUnit, ...limits() }));
      setTest("success");
    } catch (error) {
      if (error instanceof ApiResponseError) {
        setTestError({ message: translateApiError(error, t), code: error.code });
      } else {
        logger.error("Modbus test failed", { error });
        setTestError({ message: t("onboarding.modbus.failed") });
      }
      setTest("error");
    }
  }

  const submit = handleSubmit(async (values) => {
    setSaveFailed(false);
    if (!selectedUnit) return;
    try {
      await saveHruMutation.mutateAsync({ ...values, unit: selectedUnit, ...limits() });
      nextStep();
    } catch {
      setSaveFailed(true);
    }
  });

  const detail = [selectedUnitDef?.name, `${host}:${port}`].filter(Boolean).join(" · ");

  return (
    <StepFrame
      title={t("onboarding.modbus.title")}
      onNext={() => void submit()}
      busy={saveHruMutation.isPending}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_130px_130px] gap-4 @max-[520px]:grid-cols-[minmax(0,1fr)]">
        <Field label={t("onboarding.modbus.hostLabel")} required error={errors.host?.message}>
          <Input
            {...register("host", { onChange: resetTest })}
            placeholder={t("onboarding.modbus.hostPlaceholder")}
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <Field label={t("onboarding.modbus.portLabel")} required error={errors.port?.message}>
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
                  resetTest();
                }}
              />
            )}
          />
        </Field>
        <Field label={t("onboarding.modbus.unitIdLabel")} required error={errors.unitId?.message}>
          <Controller
            control={control}
            name="unitId"
            render={({ field }) => (
              <NumberInput
                value={field.value ?? null}
                min={0}
                max={255}
                onValueChange={(value) => {
                  field.onChange(value);
                  resetTest();
                }}
              />
            )}
          />
        </Field>
      </div>
      <ConnectionTest
        state={test}
        onTest={() => void runTest()}
        disabled={!selectedUnit || !host?.trim()}
        detail={detail}
        error={testError?.message}
        code={testError?.code}
        values={hruTestValues(testResult, t, temperature)}
        valuesLegend={t("settings.hru.probeResultTitle")}
      />
      {saveFailed && <Alert variant="destructive">{t("onboarding.unit.saveFailed")}</Alert>}
    </StepFrame>
  );
}
