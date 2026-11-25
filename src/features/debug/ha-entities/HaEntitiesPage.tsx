import { IconArrowLeft, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { EntityTable, type HaEntity } from "@luftuj/features/debug/components/EntityTable";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { PageHeader } from "@luftuj/shared/ui/page-header";
import { resolveApiUrl } from "@luftuj/shared/utils/api";

interface HaEntitiesResponse {
  available: boolean;
  connection?: string;
  detail?: string;
  entityCount?: number;
  entities: HaEntity[];
}

/** Entity HA: every Home Assistant entity with its state and attributes, for debugging. */
export function HaEntitiesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data, isLoading, isFetching, refetch, isError } = useQuery({
    queryKey: ["ha-entities"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/debug/home-assistant/entities"), {
        cache: "no-cache",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as HaEntitiesResponse;
    },
    staleTime: 15 * 1000,
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 font-sans text-sm leading-5 text-foreground max-md:gap-4">
      <PageHeader
        title={t("debug.haEntities.title")}
        description={t("debug.haEntities.description")}
        actions={
          <>
            <Button
              variant="ghost"
              icon={IconArrowLeft}
              onClick={() => void navigate({ to: "/debug" })}
            >
              {t("debug.haEntities.back")}
            </Button>
            <Button
              variant="secondary"
              icon={IconRefresh}
              loading={isFetching && !isLoading}
              onClick={() => void refetch()}
            >
              {t("debug.haEntities.refresh")}
            </Button>
          </>
        }
      />
      {data && !data.available && (
        <Alert variant="warning">{data.detail ?? t("debug.haEntities.unavailable")}</Alert>
      )}
      <EntityTable
        entities={data?.entities ?? []}
        loading={isLoading}
        error={isError ? t("debug.haEntities.loadFailed") : null}
      />
    </div>
  );
}
