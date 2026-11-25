import {
  IconCheck,
  IconDatabase,
  IconPlayerStop,
  IconRefresh,
  IconRss,
  IconTimelineEvent,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@luftuj/shared/ui/button";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { ICON_STROKE, type IconComponent } from "@luftuj/shared/ui/icon-types";
import { IconDamper } from "@luftuj/shared/ui/icons";
import { Legend } from "@luftuj/shared/ui/legend";
import { notify } from "@luftuj/shared/ui/notify";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { cn } from "@luftuj/shared/utils/cn";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("ToolList");

/** How long "✓ Hotovo" stays before the button comes back. */
const DONE_MS = 2200;

interface Tool {
  id: string;
  title: string;
  description: string;
  label: string;
  icon: IconComponent;
  danger?: boolean;
  /** The sentence in the in-place confirmation: what is lost, what happens next. */
  confirm?: string;
  confirmLabel?: string;
  run: () => Promise<void>;
}

type RunState = "loading" | "done" | "error";

async function post(path: string) {
  const response = await fetch(resolveApiUrl(path), { method: "POST" });
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(detail || `HTTP ${response.status}`);
  }
}

/**
 * Manual interventions: each row says what it does, has one verb, and reports Hotovo or the error in place.
 * Destructive ones sit under "Nevratné" and confirm in a red well under their row. Replaces OnboardingToolsPanel.
 */
export function ToolList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [states, setStates] = useState<Record<string, RunState | undefined>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  async function refreshSnapshot() {
    await queryClient.invalidateQueries({ queryKey: ["debug", "backend"] });
  }

  const tools: Tool[] = [
    {
      id: "discovery",
      title: t("debug.refreshDiscovery"),
      description: t("debug.tools.discoveryDescription"),
      label: t("debug.tools.refresh"),
      icon: IconRss,
      run: async () => {
        await post("/api/settings/mqtt/discovery/refresh");
        await refreshSnapshot();
      },
    },
    {
      id: "valves",
      title: t("debug.refreshValves"),
      description: t("debug.tools.valvesDescription"),
      label: t("debug.tools.refresh"),
      icon: IconDamper,
      run: async () => {
        await post("/api/valves/refresh");
        await refreshSnapshot();
      },
    },
    {
      id: "override",
      title: t("debug.stopOverride"),
      description: t("debug.tools.overrideDescription"),
      label: t("debug.tools.stop"),
      icon: IconPlayerStop,
      run: async () => {
        await post("/api/timeline/override/stop");
        await refreshSnapshot();
      },
    },
    {
      id: "scheduler",
      title: t("debug.restartScheduler"),
      description: t("debug.tools.schedulerDescription"),
      label: t("debug.tools.restart"),
      icon: IconTimelineEvent,
      run: async () => {
        await post("/api/timeline/scheduler/restart");
        await refreshSnapshot();
      },
    },
    {
      id: "onboarding",
      title: t("debug.resetOnboarding"),
      description: t("debug.tools.onboardingDescription"),
      label: t("debug.tools.reset"),
      icon: IconRefresh,
      danger: true,
      confirm: t("debug.tools.onboardingConfirm"),
      run: async () => {
        await post("/api/settings/onboarding-reset");
        globalThis.location.reload();
      },
    },
    {
      id: "database",
      title: t("debug.resetDatabase"),
      description: t("debug.tools.databaseDescription"),
      label: t("debug.tools.reset"),
      icon: IconDatabase,
      danger: true,
      confirm: t("debug.resetDatabaseConfirm"),
      confirmLabel: t("debug.tools.deleteAll"),
      run: async () => {
        await post("/api/database/reset");
        // The backend restarts; the page has nothing to show until it is back.
        notify({
          title: t("debug.databaseResetSuccess"),
          message: t("debug.databaseResetSuccessMessage"),
          variant: "success",
          autoClose: false,
        });
        globalThis.setTimeout(() => globalThis.location.reload(), 15000);
      },
    },
  ];

  async function run(tool: Tool) {
    setConfirming(null);
    setStates((current) => ({ ...current, [tool.id]: "loading" }));
    try {
      await tool.run();
      setStates((current) => ({ ...current, [tool.id]: "done" }));
      globalThis.setTimeout(
        () => setStates((current) => ({ ...current, [tool.id]: undefined })),
        DONE_MS,
      );
    } catch (error) {
      logger.error("Tool failed", { tool: tool.id, error });
      setStates((current) => ({ ...current, [tool.id]: "error" }));
    }
  }

  function row(tool: Tool) {
    const state = states[tool.id];
    const Icon = tool.icon;
    return (
      <li
        key={tool.id}
        className="grid grid-cols-[minmax(0,1fr)] border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0"
      >
        <div className="flex items-center gap-3 @max-[440px]:flex-wrap @max-[440px]:gap-y-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-9 flex-none place-items-center rounded-md bg-muted text-muted-foreground",
              tool.danger && "bg-destructive-soft text-destructive",
            )}
          >
            <Icon size={18} stroke={ICON_STROKE} />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5 @max-[440px]:basis-[calc(100%-48px)]">
            <span className="label">{tool.title}</span>
            <span className="caption text-muted-foreground">{tool.description}</span>
          </span>
          {state === "done" ? (
            <span
              role="status"
              className="inline-flex h-[34px] flex-none animate-fade items-center gap-1.5 px-1.5 font-sans text-[13px] leading-4 font-medium text-success @max-[440px]:ml-12"
            >
              <IconCheck size={16} stroke={ICON_STROKE} aria-hidden />
              {t("debug.tools.done")}
            </span>
          ) : (
            <Button
              variant={tool.danger ? "outline" : "secondary"}
              size="sm"
              loading={state === "loading"}
              aria-expanded={tool.confirm ? confirming === tool.id : undefined}
              onClick={() =>
                tool.confirm
                  ? setConfirming(confirming === tool.id ? null : tool.id)
                  : void run(tool)
              }
              className={cn(
                "flex-none @max-[440px]:ml-12",
                tool.danger &&
                  "border-[color-mix(in_oklab,var(--destructive)_40%,transparent)] text-destructive hover:not-disabled:bg-destructive-soft hover:not-disabled:text-destructive",
              )}
            >
              {tool.label}
            </Button>
          )}
        </div>
        {state === "error" && (
          <p role="alert" className="caption m-0 mt-2 ml-12 text-destructive">
            {t("debug.tools.failed")}
          </p>
        )}
        {tool.confirm && (
          <Collapse open={confirming === tool.id}>
            <div
              role="group"
              aria-label={tool.title}
              className="mt-3 grid gap-3 rounded-lg bg-destructive-soft p-4"
            >
              <p className="body m-0">{tool.confirm}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                  {t("ui.cancel")}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void run(tool)}>
                  {tool.confirmLabel ?? tool.label}
                </Button>
              </div>
            </div>
          </Collapse>
        )}
      </li>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader legend={t("debug.tools.legend")} title={t("debug.tools.title")} />
      <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] p-0">
        {tools.filter((tool) => !tool.danger).map(row)}
      </ul>
      <div className="grid gap-3 border-t border-dashed border-input pt-4">
        <Legend>{t("debug.tools.irreversible")}</Legend>
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] p-0">
          {tools.filter((tool) => tool.danger).map(row)}
        </ul>
      </div>
    </Card>
  );
}
