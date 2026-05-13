import {
  Container,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  IconRocket,
  IconAdjustments,
  IconWind,
  IconPlugConnected,
  IconServer,
} from "@tabler/icons-react";
import {
  OnboardingWizard,
  useOnboardingWizard,
} from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { WelcomeStep } from "@luftuj/features/onboarding/steps/WelcomeStep";
import { PreferencesStep } from "@luftuj/features/onboarding/steps/PreferencesStep";
import { HruDiscoveryStep } from "@luftuj/features/onboarding/steps/HruDiscoveryStep";
import { MqttStep } from "@luftuj/features/onboarding/steps/MqttStep";
import { ModbusStep } from "@luftuj/features/onboarding/steps/ModbusStep";
import { StatusStep } from "@luftuj/features/onboarding/steps/StatusStep";

const STEPS = [
  {
    labelKey: "onboarding.welcome.label",
    descKey: "onboarding.welcome.description",
    icon: IconRocket,
  },
  {
    labelKey: "onboarding.preferences.label",
    descKey: "onboarding.preferences.description",
    icon: IconAdjustments,
  },
  { labelKey: "onboarding.unit.label", descKey: "onboarding.unit.description", icon: IconWind },
  {
    labelKey: "onboarding.mqtt.label",
    descKey: "onboarding.mqtt.description",
    icon: IconPlugConnected,
  },
  {
    labelKey: "onboarding.modbus.label",
    descKey: "onboarding.modbus.description",
    icon: IconServer,
  },
  {
    labelKey: "onboarding.status.label",
    descKey: "onboarding.status.description",
    icon: IconAdjustments,
  },
];

function StepIndicator() {
  const { t } = useTranslation();
  const { currentStep, totalSteps } = useOnboardingWizard();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  if (isMobile) {
    const currentStepData = STEPS[currentStep];
    const Icon = currentStepData.icon;
    return (
      <Stack gap="xs" mb="xl">
        <Group justify="space-between" align="center">
          <Text c="dimmed" size="xs" fw={700} tt="uppercase">
            {t("onboarding.step", { current: currentStep + 1, total: totalSteps })}
          </Text>
          <Text c="dimmed" size="xs" fw={700}>
            {Math.round(((currentStep + 1) / totalSteps) * 100)}%
          </Text>
        </Group>
        <Progress value={((currentStep + 1) / totalSteps) * 100} size="sm" radius="xl" />
        <Group mt="xs">
          <ThemeIcon size={32} radius="xl" variant="light" color="blue">
            <Icon size={16} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={700} lh={1.2}>
              {t(currentStepData.labelKey)}
            </Text>
            <Text size="xs" c="dimmed" lh={1.2}>
              {t(currentStepData.descKey)}
            </Text>
          </div>
        </Group>
      </Stack>
    );
  }

  return (
    <SimpleGrid cols={3} spacing="lg" mb={50}>
      {STEPS.map((step, idx) => {
        const isActive = currentStep === idx;
        const isCompleted = currentStep > idx;
        const Icon = step.icon;
        return (
          <Group key={idx} gap="sm">
            <ThemeIcon
              size={42}
              radius="xl"
              variant={isActive ? "filled" : "light"}
              color={isActive || isCompleted ? "blue" : "gray"}
            >
              <Icon size={20} />
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={isActive ? 700 : 500} c={isActive ? undefined : "dimmed"}>
                {t(step.labelKey)}
              </Text>
              <Text size="xs" c="dimmed">
                {t(step.descKey)}
              </Text>
            </div>
          </Group>
        );
      })}
    </SimpleGrid>
  );
}

function StepContent() {
  const { currentStep } = useOnboardingWizard();

  switch (currentStep) {
    case 0:
      return <WelcomeStep />;
    case 1:
      return <PreferencesStep />;
    case 2:
      return <HruDiscoveryStep />;
    case 3:
      return <MqttStep />;
    case 4:
      return <ModbusStep />;
    case 5:
      return <StatusStep />;
    default:
      return null;
  }
}

export function OnboardingPage() {
  const { t } = useTranslation();

  return (
    <OnboardingWizard>
      <Container size="sm" py="xl">
        <Paper p={{ base: "md", sm: "xl" }} radius="md" withBorder shadow="sm">
          <Title order={2} ta="center" mb="xl">
            {t("onboarding.title")}
          </Title>
          <StepIndicator />
          <StepContent />
        </Paper>
      </Container>
    </OnboardingWizard>
  );
}
