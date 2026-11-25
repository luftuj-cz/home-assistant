import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import logoMarkDark from "@luftuj/assets/logo-mark-dark.svg";
import logoMarkLight from "@luftuj/assets/logo-mark-light.svg";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardFooter } from "@luftuj/shared/ui/card";
import { Stepper, type StepperStep } from "@luftuj/shared/ui/stepper";

interface OnboardingLayoutProps {
  step: number;
  steps: StepperStep[];
  title: ReactNode;
  lead?: ReactNode;
  /** A "Volitelné" badge next to the title. */
  optional?: boolean;
  children: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: ReactNode;
  nextDisabled?: boolean;
  busy?: boolean;
  /** Move focus to the title when the step mounts (after Zpět / Další, whose button is gone by then). */
  focusTitle?: boolean;
}

/**
 * The first-run wizard's frame: brand line, stepper, the step's title, its content and Zpět / Další. Below 680px of
 * width the stepper turns into its compact bar; on phones Zpět / Další stick to the bottom on a blurred strip, so
 * the next step stays in reach above the keyboard. Title and body fade in on every step; the stepper stays put.
 */
export function OnboardingLayout({
  step,
  steps,
  title,
  lead,
  optional,
  children,
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
  focusTitle,
}: Readonly<OnboardingLayoutProps>) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);

  return (
    <div
      data-slot="onboarding"
      className="@container mx-auto grid w-full max-w-[760px] gap-4 pt-6 max-[560px]:pt-2"
    >
      <div className="flex items-center gap-2.5 font-sans text-[15px] leading-5 font-semibold">
        <img src={logoMarkLight} alt="" width={28} height={28} className="size-7 dark:hidden" />
        <img
          src={logoMarkDark}
          alt=""
          width={28}
          height={28}
          className="hidden size-7 dark:block"
        />
        <span>LUFTaTOR</span>
        <span className="code ml-auto text-muted-foreground @max-[680px]:hidden">
          {t("onboarding.step", { current: step + 1, total: steps.length })}
        </span>
      </div>
      <Card className="gap-6 max-[560px]:gap-5 max-[560px]:p-5">
        <Stepper steps={steps} current={step} className="@max-[680px]:hidden" />
        <Stepper steps={steps} current={step} compact className="@min-[681px]:hidden" />
        <div
          key={`head-${step}`}
          className="flex animate-fade flex-wrap items-center gap-x-3 gap-y-1"
        >
          <h1 ref={titleRef} tabIndex={-1} className="section-title m-0 outline-none">
            {title}
          </h1>
          {optional && <Badge variant="outline">{t("onboarding.optional")}</Badge>}
          {lead && <p className="body m-0 basis-full text-muted-foreground">{lead}</p>}
        </div>
        <div
          key={`body-${step}`}
          className="grid animate-fade grid-cols-[minmax(0,1fr)] gap-4 [animation-delay:60ms]"
        >
          {children}
        </div>
        <CardFooter
          className={
            "items-center justify-between max-[560px]:sticky max-[560px]:bottom-0 max-[560px]:z-10 " +
            "max-[560px]:-mx-5 max-[560px]:-mb-5 max-[560px]:rounded-b-xl max-[560px]:px-5 max-[560px]:pt-3 " +
            "max-[560px]:pb-[calc(16px+env(safe-area-inset-bottom))] max-[560px]:backdrop-blur-[10px] " +
            "max-[560px]:bg-[color-mix(in_oklab,var(--card)_92%,transparent)]"
          }
        >
          {onBack ? (
            <Button variant="ghost" icon={IconChevronLeft} onClick={onBack} disabled={busy}>
              {t("onboarding.back")}
            </Button>
          ) : (
            <span />
          )}
          <Button
            iconRight={IconChevronRight}
            loading={busy}
            disabled={nextDisabled}
            onClick={onNext}
          >
            {nextLabel ?? t("onboarding.next")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
