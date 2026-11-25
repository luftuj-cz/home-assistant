import { IconUpload } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { Alert } from "@luftuj/shared/ui/alert";
import { DamperModule } from "@luftuj/shared/ui/damper-module";
import { FileButton } from "@luftuj/shared/ui/file-button";
import { translateApiError } from "@luftuj/shared/utils/apiError";

/** Vítejte: what the wizard will do, next to a damper, and a quiet way out for those who have a backup. */
export function WelcomeStep() {
  const { t } = useTranslation();
  const { nextStep, importDbMutation } = useOnboardingWizard();

  return (
    <StepFrame
      title={t("onboarding.welcome.title")}
      nextLabel={t("onboarding.welcome.button")}
      onNext={nextStep}
      nextDisabled={importDbMutation.isPending}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-6 @max-[520px]:grid-cols-[minmax(0,1fr)] @max-[520px]:justify-items-start">
        <DamperModule angle={30} size={120} />
        <p className="lead m-0">
          {t("onboarding.welcome.text")} {t("onboarding.welcome.duration")}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-4">
        <div className="grid flex-[1_1_220px] gap-0.5">
          <span className="label">{t("onboarding.welcome.importTitle")}</span>
          <span className="caption text-muted-foreground">
            {t("onboarding.welcome.importText")}
          </span>
        </div>
        <FileButton
          accept=".db,.sqlite,application/octet-stream"
          variant="outline"
          icon={IconUpload}
          disabled={importDbMutation.isPending}
          onFile={(file) => importDbMutation.mutate(file)}
        >
          {t("onboarding.welcome.importButton")}
        </FileButton>
      </div>
      {importDbMutation.isError && (
        <Alert variant="destructive" title={t("onboarding.welcome.importError")}>
          {translateApiError(importDbMutation.error, t)}
        </Alert>
      )}
    </StepFrame>
  );
}
