import { IconCalendarWeek, IconSparkles } from "@tabler/icons-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import {
  type ControlMode,
  useOnboardingWizard,
} from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { Alert } from "@luftuj/shared/ui/alert";
import { Badge } from "@luftuj/shared/ui/badge";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { RadioGroup } from "@luftuj/shared/ui/radio-group";
import { Well } from "@luftuj/shared/ui/well";

const MODES = [
  { value: "schedule", icon: IconCalendarWeek },
  { value: "automatic", icon: IconSparkles },
] as const satisfies ReadonlyArray<{ value: ControlMode; icon: typeof IconCalendarWeek }>;

function isControlMode(value: string): value is ControlMode {
  return value === "schedule" || value === "automatic";
}

/**
 * Řízení: the weekly plan or automatic control by CO₂, as two tiles, and below them how the chosen one works. Další
 * stores the choice as `control.mode`; nothing acts on it yet, it waits for LUFTaTOR Algo CO2 to be wired in.
 */
export function ControlStep() {
  const { t } = useTranslation();
  const { nextStep, controlMode, setControlMode, saveControlModeMutation } = useOnboardingWizard();
  const descriptionId = useId();
  const [failed, setFailed] = useState(false);

  async function handleNext() {
    setFailed(false);
    try {
      await saveControlModeMutation.mutateAsync(controlMode);
      nextStep();
    } catch {
      setFailed(true);
    }
  }

  return (
    <StepFrame
      title={t("onboarding.control.title")}
      onNext={() => void handleNext()}
      busy={saveControlModeMutation.isPending}
    >
      <RadioGroup
        aria-label={t("onboarding.control.groupLabel")}
        aria-describedby={descriptionId}
        value={controlMode}
        onValueChange={(value) => {
          if (isControlMode(value)) setControlMode(value);
        }}
        indicator={false}
        className="grid-cols-2 gap-3"
        items={MODES.map(({ value, icon: Icon }) => ({
          value,
          label: (
            <span className="grid justify-items-center gap-2">
              <Icon size={26} stroke={ICON_STROKE} aria-hidden className="text-air" />
              {t(`onboarding.control.${value}.title`)}
              {/* In the corner, so both icons stay centred in the same place. */}
              {value === "automatic" && (
                <Badge variant="warning" className="pointer-events-none absolute top-2.5 right-2.5">
                  {t("onboarding.control.beta")}
                </Badge>
              )}
            </span>
          ),
        }))}
      />
      <Well id={descriptionId} aria-live="polite">
        <p key={controlMode} className="body m-0 animate-fade">
          {t(`onboarding.control.${controlMode}.text`)}
        </p>
      </Well>
      {failed && <Alert variant="destructive">{t("onboarding.errors.controlSaveFailed")}</Alert>}
    </StepFrame>
  );
}
