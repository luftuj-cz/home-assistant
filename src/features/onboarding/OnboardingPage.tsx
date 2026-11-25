import {
  OnboardingWizard,
  useOnboardingWizard,
} from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { ControlStep } from "@luftuj/features/onboarding/steps/ControlStep";
import { HruDiscoveryStep } from "@luftuj/features/onboarding/steps/HruDiscoveryStep";
import { ModbusStep } from "@luftuj/features/onboarding/steps/ModbusStep";
import { MqttStep } from "@luftuj/features/onboarding/steps/MqttStep";
import { PreferencesStep } from "@luftuj/features/onboarding/steps/PreferencesStep";
import { StatusStep } from "@luftuj/features/onboarding/steps/StatusStep";
import { WelcomeStep } from "@luftuj/features/onboarding/steps/WelcomeStep";

const STEP_COMPONENTS = [
  WelcomeStep,
  PreferencesStep,
  ControlStep,
  HruDiscoveryStep,
  MqttStep,
  ModbusStep,
  StatusStep,
];

function CurrentStep() {
  const { currentStep } = useOnboardingWizard();
  const Step = STEP_COMPONENTS[currentStep];
  return Step ? <Step /> : null;
}

/** The first-run wizard: each step draws itself inside OnboardingLayout (via StepFrame). */
export function OnboardingPage() {
  return (
    <OnboardingWizard>
      <CurrentStep />
    </OnboardingWizard>
  );
}
