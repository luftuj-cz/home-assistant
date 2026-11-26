import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { JournalEntry } from "@luftuj/features/automatic/api";
import { useAutomaticJournal } from "@luftuj/features/automatic/hooks";
import { Alert } from "@luftuj/shared/ui/alert";
import { Card, CardContent, CardHeader } from "@luftuj/shared/ui/card";
import { EmptyState } from "@luftuj/shared/ui/empty-state";

function time(at: string, language: string): string {
  const date = new Date(at);
  const sameDay = date.toDateString() === new Date().toDateString();
  const clock = date.toLocaleTimeString(language);
  return sameDay ? clock : `${date.toLocaleDateString(language)} ${clock}`;
}

function summary(entry: JournalEntry, t: TFunction): string {
  const data = entry.data ?? {};
  switch (entry.kind) {
    case "branch":
      return t("automatic.journal.branch", {
        to: t(`automatic.branches.${String(data.to)}`),
      });
    case "valves": {
      const valves = (data.valves as { entityId: string; from: number | null; to: number }[]) ?? [];
      return valves
        .map((valve) => `${valve.entityId}: ${valve.from ?? "?"}° → ${valve.to}°`)
        .join(", ");
    }
    case "power": {
      const unit = data.unit as { from: number; to: number } | null;
      const review = data.review as { lane: string } | null;
      return t("automatic.journal.power", {
        before: data.before,
        after: data.after,
        unit: unit ? ` (${unit.from} → ${unit.to})` : "",
        lane: review ? ` · ${t(`automatic.journal.lanes.${review.lane}`)}` : "",
      });
    }
    case "cannotRun":
      return data.reason
        ? t(`automatic.reasons.${String(data.reason)}`)
        : t("automatic.journal.canRun");
    case "stop":
      return t("automatic.journal.stop", { source: String(data.source ?? "?") });
    case "rooms":
      return t(`automatic.journal.rooms.${String(data.action)}`, { name: data.name ?? "" });
    default:
      return t(`automatic.journal.kinds.${entry.kind}`);
  }
}

/** What automatic control decided, newest first. The same rows go into the bug report. */
export function JournalCard() {
  const { t, i18n } = useTranslation();
  const { data: entries = [], isError } = useAutomaticJournal();

  return (
    <Card>
      <CardHeader
        legend={t("automatic.journal.legend")}
        title={t("automatic.journal.title")}
        description={t("automatic.journal.description")}
      />
      <CardContent>
        {isError && <Alert variant="destructive">{t("automatic.journal.loadFailed")}</Alert>}
        {!isError && entries.length === 0 && <EmptyState title={t("automatic.journal.empty")} />}
        {entries.length > 0 && (
          <ol className="m-0 grid max-h-[420px] list-none gap-1 overflow-y-auto p-0">
            {entries.map((entry) => (
              <li key={entry.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-1">
                <span className="code text-muted-foreground tabular-nums">
                  {time(entry.at, i18n.language)}
                </span>
                <span className="caption">
                  <span className="font-medium">{t(`automatic.journal.kinds.${entry.kind}`)}</span>
                  {entry.kind !== "start" && entry.kind !== "parameters" && (
                    <> · {summary(entry, t)}</>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
