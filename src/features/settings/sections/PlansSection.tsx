import { IconCalendarEvent } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { useCustomPlans } from "@luftuj/features/dashboard/hooks/useCustomPlans";
import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import { CustomPlanList } from "@luftuj/features/settings/components/CustomPlanList";

/**
 * Vlastní plány, its own section now instead of a panel inside Roční období. The closed section says which plan
 * runs (or is scheduled) and how many there are.
 */
export function PlansSection() {
  const { t } = useTranslation();
  const { data } = useCustomPlans(undefined);
  const plans = data?.timelines ?? [];
  const override = data?.override ?? null;

  return (
    <SettingsSection
      value="plans"
      index="04"
      icon={IconCalendarEvent}
      title={t("settings.customTimelines.title")}
      description={t("settings.customTimelines.sectionDescription")}
      summary={
        <>
          {override && (
            <SummaryChip tone="plan">
              {t(
                override.phase === "scheduled"
                  ? "settings.customTimelines.scheduled"
                  : "settings.customTimelines.running",
                { name: override.name ?? "?" },
              )}
            </SummaryChip>
          )}
          <SummaryChip>{t("settings.customTimelines.count", { count: plans.length })}</SummaryChip>
        </>
      }
    >
      <CustomPlanList />
    </SettingsSection>
  );
}
