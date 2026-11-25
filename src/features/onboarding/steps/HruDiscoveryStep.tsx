import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { localizedText } from "@luftuj/features/timeline/utils";
import { Alert } from "@luftuj/shared/ui/alert";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { Field } from "@luftuj/shared/ui/field";
import { Fieldset } from "@luftuj/shared/ui/fieldset";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Skeleton } from "@luftuj/shared/ui/skeleton";

/**
 * Jednotka: the model (searchable, grouped by brand) and, where the unit lets you, its own power limits. Errors show
 * at the fields once Další was pressed. A demo unit has no Modbus address to ask for, so it is saved here.
 */
export function HruDiscoveryStep() {
  const { t } = useTranslation();
  const {
    nextStep,
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
    units,
    unitsQuery,
    saveHruMutation,
    modbusForm,
  } = useOnboardingWizard();
  const [attempted, setAttempted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // No brand groups: every name starts with its brand, and most brands have a single unit, so a heading would only
  // repeat the name and double the list on a phone.
  const unitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.id, label: unit.name })),
    [units],
  );

  const powerUnit = powerVariable?.unit ? localizedText(powerVariable.unit, t) : "%";
  const minMissing = requiresMinPower && minPower == null;
  const maxMissing = requiresMaxPower && maxPower == null;
  const effectiveMax = maxPower ?? powerVariable?.max;
  const minAboveMax =
    requiresMinPower && minPower != null && effectiveMax !== undefined && minPower > effectiveMax;

  let minError: string | undefined;
  if (attempted && minMissing) minError = t("onboarding.unit.minPowerRequired");
  else if (minAboveMax) minError = t("settings.hru.configuration.minPowerAboveMax");

  async function handleNext() {
    setAttempted(true);
    setSaveFailed(false);
    if (!selectedUnit || minMissing || maxMissing || minAboveMax) return;
    if (!isDemoUnit) {
      nextStep();
      return;
    }
    try {
      await saveHruMutation.mutateAsync({
        ...modbusForm.getValues(),
        unit: selectedUnit,
        minPower: requiresMinPower ? minPower : undefined,
        maxPower: requiresMaxPower ? maxPower : undefined,
      });
      nextStep();
    } catch {
      setSaveFailed(true);
    }
  }

  let unitField;
  if (unitsQuery.isLoading) {
    unitField = <Skeleton className="h-11 rounded-md" />;
  } else if (unitsQuery.isError) {
    unitField = <Alert variant="destructive">{t("onboarding.unit.loadFailed")}</Alert>;
  } else {
    unitField = (
      <Combobox
        options={unitOptions}
        value={selectedUnit}
        onValueChange={setSelectedUnit}
        placeholder={t("onboarding.unit.modelPlaceholder")}
        searchable
      />
    );
  }

  return (
    <StepFrame
      title={t("onboarding.unit.title")}
      onNext={() => void handleNext()}
      busy={saveHruMutation.isPending}
    >
      <Field
        label={t("onboarding.unit.modelLabel")}
        required
        description={t("onboarding.unit.hint")}
        error={attempted && !selectedUnit ? t("onboarding.unit.error") : undefined}
      >
        {unitField}
      </Field>
      {(requiresMinPower || requiresMaxPower) && (
        <Fieldset
          legend={t("settings.hru.configuration.title")}
          icon={IconAdjustmentsHorizontal}
          description={
            requiresMinPower
              ? t("settings.hru.configuration.limitsDescription")
              : t("settings.hru.configuration.maxPowerDescription")
          }
        >
          <div className="grid grid-cols-2 gap-4 @max-[520px]:grid-cols-[minmax(0,1fr)]">
            {requiresMinPower && (
              <Field
                label={t("settings.hru.configuration.minPowerLabel")}
                description={t("settings.hru.configuration.minPowerHint", {
                  default: defaultMinPower,
                  unit: powerUnit,
                })}
                error={minError}
              >
                <NumberInput
                  value={minPower ?? defaultMinPower ?? null}
                  min={powerVariable?.min ?? 0}
                  max={effectiveMax ?? 10000}
                  unit={powerUnit}
                  invalid={Boolean(minError)}
                  onValueChange={setMinPower}
                />
              </Field>
            )}
            {requiresMaxPower && (
              <Field
                label={t("settings.hru.configuration.maxPowerLabel")}
                description={t("settings.hru.configuration.maxPowerHint", {
                  default: defaultMaxPower,
                  unit: powerUnit,
                })}
                error={attempted && maxMissing ? t("onboarding.unit.maxPowerRequired") : undefined}
              >
                <NumberInput
                  value={maxPower ?? defaultMaxPower ?? null}
                  min={1}
                  max={powerVariable?.max ?? 10000}
                  unit={powerUnit}
                  onValueChange={setMaxPower}
                />
              </Field>
            )}
          </div>
        </Fieldset>
      )}
      {saveFailed && <Alert variant="destructive">{t("onboarding.unit.saveFailed")}</Alert>}
    </StepFrame>
  );
}
