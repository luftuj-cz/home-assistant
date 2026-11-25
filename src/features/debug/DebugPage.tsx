import { IconExternalLink } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { CommissioningCard } from "@luftuj/features/debug/components/CommissioningCard";
import { DebugStats } from "@luftuj/features/debug/components/DebugStats";
import { Inspector } from "@luftuj/features/debug/components/Inspector";
import { LogStream } from "@luftuj/features/debug/components/LogStream";
import { ToolList } from "@luftuj/features/debug/components/ToolList";
import { Button } from "@luftuj/shared/ui/button";
import { PageHeader } from "@luftuj/shared/ui/page-header";

/**
 * Ladění: one workbench instead of five tabs. Watching (log, values) and acting (test, tools) sit on screen
 * together: stats on top, the log beside the commissioning test and the tools, the Inspector across the bottom.
 * On a phone the same blocks stack in that order.
 */
export function DebugPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 font-sans text-sm leading-5 text-foreground max-md:gap-4">
      <PageHeader
        title={t("debug.title")}
        description={t("debug.description")}
        actions={
          <Button
            variant="secondary"
            iconRight={IconExternalLink}
            onClick={() => void navigate({ to: "/debug/home-assistant" })}
          >
            {t("debug.haEntities.openLink")}
          </Button>
        }
      />
      <DebugStats />
      <div className="grid grid-cols-12 items-start gap-6 max-lg:grid-cols-[minmax(0,1fr)] max-md:gap-4">
        <div className="col-span-8 grid min-w-0 max-lg:col-span-1">
          <LogStream />
        </div>
        <div className="col-span-4 grid min-w-0 gap-6 max-lg:col-span-1 max-md:gap-4">
          <CommissioningCard />
          <ToolList />
        </div>
      </div>
      <Inspector />
    </div>
  );
}
