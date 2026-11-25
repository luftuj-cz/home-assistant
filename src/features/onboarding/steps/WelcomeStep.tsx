import { IconUpload } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { StepFrame } from "@luftuj/features/onboarding/components/StepFrame";
import { useOnboardingWizard } from "@luftuj/features/onboarding/hooks/useOnboardingWizard";
import { Alert } from "@luftuj/shared/ui/alert";
import { DamperModule } from "@luftuj/shared/ui/damper-module";
import { FileButton } from "@luftuj/shared/ui/file-button";
import { translateApiError } from "@luftuj/shared/utils/apiError";

/** Blade speed of the welcome demo (°/s): a full stroke takes about three and a half seconds. */
const DEMO_SPEED = 27.5;
/** One stroke plus a pause at each end, open or closed. */
const DEMO_PERIOD_MS = 4800;
/** The first turn comes sooner, so the motion shows up shortly after the page opens. */
const DEMO_FIRST_MS = 1200;

/** Opens and closes the damper slowly and forever; with reduced motion it stays half open. */
function useDemoAngle() {
  const [closed, setClosed] = useState(false);
  const [still] = useState(
    () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    if (still) return;
    let timer: ReturnType<typeof setTimeout>;
    function turn() {
      setClosed((value) => !value);
      timer = setTimeout(turn, DEMO_PERIOD_MS);
    }
    timer = setTimeout(turn, DEMO_FIRST_MS);
    return () => clearTimeout(timer);
  }, [still]);
  if (still) return 30;
  return closed ? 90 : 0;
}

/** Vítejte: what the wizard will do, next to a damper, and a quiet way out for those who have a backup. */
export function WelcomeStep() {
  const { t } = useTranslation();
  const { nextStep, importDbMutation } = useOnboardingWizard();
  const demoAngle = useDemoAngle();

  return (
    <StepFrame
      title={t("onboarding.welcome.title")}
      nextLabel={t("onboarding.welcome.button")}
      onNext={nextStep}
      nextDisabled={importDbMutation.isPending}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-6 @max-[520px]:grid-cols-[minmax(0,1fr)] @max-[520px]:justify-items-center @max-[520px]:gap-4">
        <DamperModule angle={demoAngle} speed={DEMO_SPEED} size={120} />
        <div className="grid gap-1 @max-[520px]:max-w-[34ch] @max-[520px]:text-center">
          <p className="lead m-0 text-balance">{t("onboarding.welcome.text")}</p>
          <p className="body m-0 text-muted-foreground">{t("onboarding.welcome.duration")}</p>
        </div>
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
          className="@max-[520px]:w-full @max-[520px]:[&>button]:flex-1"
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
