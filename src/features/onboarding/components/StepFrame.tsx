import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { OnboardingLayout } from "@luftuj/features/onboarding/components/OnboardingLayout";
import {
  ONBOARDING_STEPS,
  useOnboardingWizard,
} from "@luftuj/features/onboarding/hooks/useOnboardingWizard";

type StepFrameProps = Omit<
  ComponentProps<typeof OnboardingLayout>,
  "step" | "steps" | "onBack" | "focusTitle"
>;

/** OnboardingLayout with the wizard's step, the six step names and Zpět filled in; a step adds its title and body. */
export function StepFrame(props: Readonly<StepFrameProps>) {
  const { t } = useTranslation();
  const { currentStep, prevStep, navigated } = useOnboardingWizard();
  const steps = ONBOARDING_STEPS.map((key) => ({
    label: t(`onboarding.${key}.label`),
    description: t(`onboarding.${key}.description`),
  }));

  return (
    <OnboardingLayout
      {...props}
      step={currentStep}
      steps={steps}
      onBack={currentStep > 0 ? prevStep : undefined}
      focusTitle={navigated}
    />
  );
}
