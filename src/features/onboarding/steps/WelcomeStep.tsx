import { Button, Divider, Stack, Text, ThemeIcon } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { IconRocket, IconArrowRight } from "@tabler/icons-react";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";

export function WelcomeStep() {
  const { t } = useTranslation();
  const { nextStep, importDbMutation, importInputRef } = useOnboardingWizard();

  return (
    <Stack align="center" py="xl">
      <ThemeIcon size={80} radius="xl" variant="light" color="blue">
        <IconRocket size={48} />
      </ThemeIcon>
      <Text ta="center" fw={700} size="xl">
        {t("onboarding.welcome.title")}
      </Text>
      <Text c="dimmed" ta="center" maw={400}>
        {t("onboarding.welcome.text")}
      </Text>
      <Button size="lg" mt="md" rightSection={<IconArrowRight size={18} />} onClick={nextStep}>
        {t("onboarding.welcome.button")}
      </Button>
      <Divider label={t("app.nav.optional")} labelPosition="center" w="100%" maw={300} />
      <Text size="xs" c="dimmed" ta="center">
        {t("onboarding.welcome.importText")}
      </Text>
      <Button
        variant="subtle"
        size="sm"
        loading={importDbMutation.isPending}
        onClick={() => importInputRef.current?.click()}
      >
        {t("onboarding.welcome.importButton")}
      </Button>
      <input
        ref={importInputRef}
        type="file"
        accept=".db,application/octet-stream"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importDbMutation.mutate(file);
          e.target.value = "";
        }}
      />
    </Stack>
  );
}
