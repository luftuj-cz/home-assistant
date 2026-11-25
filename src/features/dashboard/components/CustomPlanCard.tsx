import { IconCalendarEvent, IconPencil, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCustomPlans } from "@luftuj/features/dashboard/hooks/useCustomPlans";
import {
  activateCustomOverride,
  endCustomOverride,
} from "@luftuj/features/timeline/customTimelinesApi";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { notify } from "@luftuj/shared/ui/notify";
import { Tooltip, TooltipContent, TooltipTrigger } from "@luftuj/shared/ui/tooltip";
import { translateApiError } from "@luftuj/shared/utils/apiError";

import { PlanStartDialog, type OverrideRequest } from "./PlanStartDialog";

function formatWhen(iso: string, language: string) {
  return new Date(iso).toLocaleString(language, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "zbývá 3 d 4 h", "zbývá 4 h 12 min" or "zbývá 12 min", whichever reads best. */
function formatRemaining(iso: string, t: TFunction) {
  const total = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return t("dashboard.customOverride.remainingDays", { days, hours });
  if (hours > 0) return t("dashboard.customOverride.remainingHours", { hours, minutes });
  return t("dashboard.customOverride.remainingMinutes", { minutes });
}

/**
 * "Vlastní plán" (replaces CustomOverrideCard): switches a custom timeline on and shows when it runs and ends. Idle is
 * a plain plane with a Zapnout button; running or scheduled tints the whole plane plum. Hidden when there are no plans
 * and none is running. Viewing a plan on the timeline never activates it; this card does.
 */
export function CustomPlanCard({ unitId }: Readonly<{ unitId?: string }>) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useCustomPlans(unitId);
  const plans = data?.timelines ?? [];
  const override = data?.override ?? null;
  const usable = plans.some((plan) => plan.enabledEvents > 0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["custom-timelines"] }),
    [queryClient],
  );
  const fail = useCallback(
    (error: unknown) =>
      notify({
        variant: "error",
        title: t("dashboard.customOverride.errorTitle"),
        message: translateApiError(error, t),
      }),
    [t],
  );

  async function activate(request: OverrideRequest) {
    setBusy(true);
    try {
      await activateCustomOverride(request, unitId);
      await refresh();
      setDialogOpen(false);
      const name = plans.find((plan) => plan.id === request.customTimelineId)?.name ?? "";
      notify({
        variant: "plan",
        title: t("dashboard.customOverride.title"),
        message: t(
          request.startsAt
            ? "dashboard.customOverride.scheduledMessage"
            : "dashboard.customOverride.activatedMessage",
          { name },
        ),
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    try {
      await endCustomOverride(unitId);
      await refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  // Nothing to switch on and nothing running: the feature stays out of the way.
  if (plans.length === 0 && !override) {
    return null;
  }

  const scheduled = override?.phase === "scheduled";
  let title = t("dashboard.customOverride.title");
  let description = t("dashboard.customOverride.description");
  if (override) {
    const name = override.name ?? "?";
    title = scheduled
      ? t("dashboard.customOverride.scheduledRow", {
          name,
          start: formatWhen(override.startsAt, i18n.language),
        })
      : t("dashboard.customOverride.activeRow", { name });
    const parts = [
      override.endsAt
        ? t("dashboard.customOverride.until", { end: formatWhen(override.endsAt, i18n.language) })
        : t("dashboard.customOverride.untilEnded"),
    ];
    if (override.endsAt && !scheduled) parts.push(formatRemaining(override.endsAt, t));
    description = parts.join(" · ");
  }

  const start = (
    <Button
      variant="plan"
      size="sm"
      icon={IconPlayerPlay}
      // aria-disabled, not disabled: a disabled button swallows hover and focus, and the tooltip says why it is off.
      aria-disabled={!usable || undefined}
      className={!usable ? "cursor-not-allowed opacity-45" : undefined}
      onClick={() => {
        if (usable) setDialogOpen(true);
      }}
    >
      {t("dashboard.customOverride.open")}
    </Button>
  );

  return (
    <Card className={override ? "bg-plan-soft" : undefined}>
      <CardHeader
        icon={IconCalendarEvent}
        iconTone="plan"
        title={title}
        description={description}
      />
      {override?.degraded && (
        <Alert variant="destructive">{t("dashboard.customOverride.degraded")}</Alert>
      )}
      {override && !override.appliesToCurrentUnit && (
        <p className="caption text-muted-foreground">{t("dashboard.customOverride.otherUnit")}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {override ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={IconPencil}
              disabled={busy || !usable}
              onClick={() => setDialogOpen(true)}
            >
              {t("dashboard.customOverride.change")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              icon={IconX}
              loading={busy}
              onClick={() => void end()}
            >
              {scheduled ? t("dashboard.customOverride.cancel") : t("dashboard.customOverride.end")}
            </Button>
          </>
        ) : usable ? (
          start
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{start}</TooltipTrigger>
            <TooltipContent wrap>{t("dashboard.customOverride.noneUsable")}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <PlanStartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        plans={plans}
        current={override}
        busy={busy}
        onSubmit={(request) => void activate(request)}
      />
    </Card>
  );
}
