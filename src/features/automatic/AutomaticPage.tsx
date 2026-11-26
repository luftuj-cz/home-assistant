import { useTranslation } from "react-i18next";

import { JournalCard } from "@luftuj/features/automatic/components/JournalCard";
import { ParametersCard } from "@luftuj/features/automatic/components/ParametersCard";
import { RoomsCard } from "@luftuj/features/automatic/components/RoomsCard";
import { StatusCard } from "@luftuj/features/automatic/components/StatusCard";
import { PageHeader } from "@luftuj/shared/ui/page-header";

/**
 * Automatika: automatic control by CO₂ (LUFTaTOR Algo CO2) for development and testers. Status, rooms,
 * parameters and the decision journal; a graphical room setup comes later in 2.0.
 */
export function AutomaticPage() {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 font-sans text-sm leading-5 text-foreground max-md:gap-4">
      <PageHeader title={t("automatic.title")} description={t("automatic.description")} />
      <StatusCard />
      <RoomsCard />
      <ParametersCard />
      <JournalCard />
    </div>
  );
}
