import {
  IconCalendarEvent,
  IconExternalLink,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createCustomTimeline,
  deleteCustomTimeline,
  fetchCustomTimelines,
  renameCustomTimeline,
} from "@luftuj/features/timeline/customTimelinesApi";
import type { CustomTimelineSummary } from "@luftuj/shared/types/customTimeline";
import { Alert } from "@luftuj/shared/ui/alert";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { Menu } from "@luftuj/shared/ui/dropdown-menu";
import { Field } from "@luftuj/shared/ui/field";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Input } from "@luftuj/shared/ui/input";
import { notify } from "@luftuj/shared/ui/notify";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { cn } from "@luftuj/shared/utils/cn";

/**
 * Settings → Vlastní plány (replaces CustomTimelinesPanel with its rename and delete modals): a row per plan with
 * its state, event count, "Otevřít na časové ose" and a menu. Rename happens in the row; delete confirms in the
 * row, and a running or scheduled plan explains why it cannot go. New plans at the bottom.
 */
export function CustomPlanList() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["custom-timelines", "current"],
    queryFn: () => fetchCustomTimelines(),
    staleTime: 15 * 1000,
  });
  const plans = data?.timelines ?? [];

  async function run(action: () => Promise<unknown>, onDone?: () => void) {
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["custom-timelines"] });
      onDone?.();
    } catch (error) {
      notify({
        variant: "error",
        title: t("settings.customTimelines.errorTitle"),
        message: translateApiError(error, t),
      });
    } finally {
      setBusy(false);
    }
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    void run(
      () => createCustomTimeline(name),
      () => setNewName(""),
    );
  }

  function openInTimeline(id: number) {
    void navigate({ to: "/timeline", search: { custom: id } });
  }

  function saveRename(plan: CustomTimelineSummary) {
    const name = renameValue.trim();
    if (!name || name === plan.name) {
      setRenaming(null);
      return;
    }
    void run(
      () => renameCustomTimeline(plan.id, name),
      () => setRenaming(null),
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="body text-muted-foreground">{t("settings.customTimelines.description")}</p>
      {isLoading && <Skeleton className="h-14 rounded-lg" />}
      {!isLoading && plans.length === 0 && (
        <p className="body text-muted-foreground">{t("settings.customTimelines.empty")}</p>
      )}
      <ul className="m-0 grid list-none gap-2 p-0">
        {plans.map((plan) => {
          const running = plan.overridePhase === "active";
          const scheduled = plan.overridePhase === "scheduled";
          const editing = renaming === plan.id;
          return (
            <li
              key={plan.id}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)] rounded-lg bg-muted px-3 py-2.5 transition-[background-color] duration-(--duration-base)",
                running && "bg-plan-soft",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span className="grid size-9 flex-none place-items-center rounded-md bg-card text-plan">
                  <IconCalendarEvent size={18} stroke={ICON_STROKE} aria-hidden />
                </span>
                {editing ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveRename(plan);
                    }}
                  >
                    <Input
                      autoFocus
                      value={renameValue}
                      maxLength={60}
                      aria-label={t("settings.customTimelines.renameAria", { name: plan.name })}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRenaming(null);
                      }}
                      className="h-9 bg-card"
                    />
                    <Button type="submit" size="sm" loading={busy} disabled={!renameValue.trim()}>
                      {t("settings.customTimelines.save")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                      {t("ui.cancel")}
                    </Button>
                  </form>
                ) : (
                  <span className="grid min-w-0 flex-1">
                    <span className="label truncate" title={plan.name}>
                      {plan.name}
                    </span>
                    <span className="caption truncate text-muted-foreground">
                      {plan.enabledEvents === 0
                        ? t("settings.customTimelines.noEvents")
                        : t("settings.customTimelines.eventCount", { count: plan.enabledEvents })}
                    </span>
                  </span>
                )}
                {!editing && (
                  <span className="flex flex-none items-center gap-1">
                    {running && (
                      <Badge variant="plan" dot>
                        {t("settings.customTimelines.phaseActive")}
                      </Badge>
                    )}
                    {scheduled && (
                      <Badge variant="outline">
                        {t("settings.customTimelines.phaseScheduled")}
                      </Badge>
                    )}
                    {/* Phones get the icon only: the full label would push the row out (the design hides it). */}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconRight={IconExternalLink}
                      onClick={() => openInTimeline(plan.id)}
                      className="max-[560px]:hidden"
                    >
                      {t("settings.customTimelines.openInTimeline")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      icon={IconExternalLink}
                      aria-label={t("settings.customTimelines.openInTimeline")}
                      title={t("settings.customTimelines.openInTimeline")}
                      onClick={() => openInTimeline(plan.id)}
                      className="min-[561px]:hidden"
                    />
                    <Menu
                      label={t("settings.customTimelines.actions", { name: plan.name })}
                      items={[
                        {
                          label: t("settings.customTimelines.rename"),
                          icon: IconPencil,
                          onSelect: () => {
                            setDeleting(null);
                            setRenameValue(plan.name);
                            setRenaming(plan.id);
                          },
                        },
                        {
                          label: t("settings.customTimelines.delete"),
                          icon: IconTrash,
                          destructive: true,
                          onSelect: () => setDeleting(plan.id),
                        },
                      ]}
                    />
                  </span>
                )}
              </div>
              <Collapse open={deleting === plan.id}>
                {running || scheduled ? (
                  <div className="mt-3 grid gap-3">
                    <Alert variant="plan">{t("settings.customTimelines.deleteBlocked")}</Alert>
                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                        {t("settings.customTimelines.deleteBlockedOk")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 rounded-lg bg-destructive-soft p-4">
                    <p className="body m-0">
                      <b className="font-semibold">
                        {t("settings.customTimelines.deleteTitle", { name: plan.name })}
                      </b>{" "}
                      {t("settings.customTimelines.deleteBody", { count: plan.totalEvents })}
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                        {t("ui.cancel")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        icon={IconTrash}
                        loading={busy}
                        onClick={() =>
                          void run(
                            () => deleteCustomTimeline(plan.id),
                            () => setDeleting(null),
                          )
                        }
                      >
                        {t("settings.customTimelines.delete")}
                      </Button>
                    </div>
                  </div>
                )}
              </Collapse>
            </li>
          );
        })}
      </ul>
      <form
        className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 border-t border-dashed border-input pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <Field label={t("settings.customTimelines.newLabel")}>
          <Input
            value={newName}
            maxLength={60}
            placeholder={t("settings.customTimelines.newPlaceholder")}
            onChange={(event) => setNewName(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          icon={IconPlus}
          loading={busy && newName.trim() !== ""}
          disabled={!newName.trim()}
        >
          {t("settings.customTimelines.create")}
        </Button>
      </form>
    </div>
  );
}
