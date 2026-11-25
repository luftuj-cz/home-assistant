import {
  IconChevronDown,
  IconDownload,
  IconPlayerPause,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useServerLogs } from "@luftuj/features/debug/hooks/useDebugData";
import { formatLogContext, type ServerLogEntry } from "@luftuj/features/debug/utils";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { Dot } from "@luftuj/shared/ui/dot";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Mark, matchesSearch } from "@luftuj/shared/ui/mark";
import { notify } from "@luftuj/shared/ui/notify";
import { SearchInput } from "@luftuj/shared/ui/search-input";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { cn } from "@luftuj/shared/utils/cn";
import { triggerBlobDownload } from "@luftuj/shared/utils/download";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("LogStream");

const LEVEL_ORDER = ["fatal", "error", "warn", "warning", "info", "debug", "trace"];

type Tone = "destructive" | "warning" | "air" | "neutral";

function toneOf(level: string): Tone {
  if (level === "fatal" || level === "error") return "destructive";
  if (level === "warn" || level === "warning") return "warning";
  if (level === "info") return "air";
  return "neutral";
}

const LEVEL_TEXT: Record<Tone, string> = {
  destructive: "text-destructive",
  warning: "text-warning",
  air: "text-air",
  neutral: "text-muted-foreground",
};

const CHIP_ON: Record<Tone | "all", string> = {
  all: "text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground)]",
  destructive: "text-destructive shadow-[inset_0_0_0_1.5px_var(--destructive)]",
  warning: "text-warning shadow-[inset_0_0_0_1.5px_var(--warning)]",
  air: "text-air shadow-[inset_0_0_0_1.5px_var(--air)]",
  neutral: "text-foreground shadow-[inset_0_0_0_1.5px_var(--foreground)]",
};

interface LogRow {
  id: string;
  level: string;
  time: string;
  timestamp: string;
  message: string;
  context: string;
}

function clockTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString("cs-CZ", { hour12: false });
}

/** Newest first. Ids stay stable across refreshes, so an open context stays open when new lines arrive. */
function toRows(logs: ServerLogEntry[]): LogRow[] {
  const ordered = logs.toSorted(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const seen = new Map<string, number>();
  return ordered.map((entry) => {
    const signature = `${entry.timestamp}|${entry.level}|${entry.line}`;
    const occurrence = seen.get(signature) ?? 0;
    seen.set(signature, occurrence + 1);
    return {
      id: `${signature}#${occurrence}`,
      level: entry.level.toLowerCase(),
      time: clockTime(entry.timestamp),
      timestamp: entry.timestamp,
      message: entry.message,
      context: formatLogContext(entry.context),
    };
  });
}

/**
 * Live tail of the server log: newest line on top, filter by level and text, a line opens its context. Paused, the
 * list freezes so a line can be read or copied, and the pill counts what arrived meanwhile. Replaces ServerLogsPanel.
 */
export function LogStream() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch, isFetching } = useServerLogs();
  const rows = useMemo(() => toRows(data?.logs ?? []), [data]);
  const [frozen, setFrozen] = useState<LogRow[] | null>(null);
  const paused = frozen !== null;
  const source = frozen ?? rows;
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Lines from the first load do not flash; anything after them slides in.
  const [initialIds, setInitialIds] = useState<Set<string> | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (data && initialIds === null) setInitialIds(new Set(toRows(data.logs).map((row) => row.id)));
  }, [data, initialIds]);

  // Live: a new line pulls the list back to the top, but only for someone already near it.
  const newest = source[0]?.id;
  useEffect(() => {
    const list = listRef.current;
    if (list && !paused && list.scrollTop < 80) list.scrollTop = 0;
  }, [newest, paused]);

  const frozenIds = useMemo(() => new Set(frozen?.map((row) => row.id)), [frozen]);
  const pending = paused ? rows.filter((row) => !frozenIds.has(row.id)).length : 0;

  const counts = new Map<string, number>();
  for (const row of source) counts.set(row.level, (counts.get(row.level) ?? 0) + 1);
  const levels = [...counts.keys()].toSorted(
    (a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b),
  );
  const shown = source.filter(
    (row) =>
      (level === "all" || row.level === level) &&
      (matchesSearch(row.message, search) || matchesSearch(row.context, search)),
  );

  function togglePaused() {
    setFrozen(paused ? null : rows);
  }

  async function download() {
    setDownloading(true);
    try {
      const response = await fetch(resolveApiUrl("/api/debug/logs/download?limit=1000"));
      if (!response.ok) {
        notify({
          title: t("debug.logs.downloadFailedTitle"),
          message: t("debug.logs.downloadFailed", { status: response.status }),
          variant: "error",
        });
        return;
      }
      triggerBlobDownload(await response.blob(), `luftator-logs-${Date.now()}.log`);
    } catch (downloadError) {
      logger.error("Server log download failed", { error: downloadError });
      notify({
        title: t("debug.logs.downloadFailedTitle"),
        message: t("debug.logs.downloadFailedUnknown"),
        variant: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  let body;
  if (isLoading) {
    body = (
      <div className="grid content-center justify-items-center gap-2 p-6 text-center">
        <Spinner size={18} label={t("debug.logs.loading")} />
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className="grid content-center justify-items-center gap-2 p-6 text-center text-muted-foreground">
        <IconTerminal2 size={22} stroke={ICON_STROKE} aria-hidden />
        <span className="body">
          {source.length === 0 ? t("debug.logs.noData") : t("debug.logs.noMatches")}
        </span>
        {source.length > 0 && (
          <Button
            variant="link"
            onClick={() => {
              setSearch("");
              setLevel("all");
            }}
          >
            {t("debug.logs.clearFilter")}
          </Button>
        )}
      </div>
    );
  } else {
    body = (
      <ol
        ref={listRef}
        tabIndex={0}
        aria-label={t("debug.serverLogs")}
        className="m-0 list-none overflow-y-auto overscroll-contain p-1.5 [scrollbar-color:var(--input)_transparent] [scrollbar-width:thin] focus-visible:rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {shown.map((row) => {
          const tone = toneOf(row.level);
          const isOpen = open === row.id;
          const fresh = initialIds !== null && !initialIds.has(row.id);
          return (
            <li
              key={row.id}
              className={cn(
                "rounded-sm [&+&]:mt-px",
                tone === "destructive" &&
                  "bg-[color-mix(in_oklab,var(--destructive-soft)_70%,transparent)]",
                tone === "warning" &&
                  "bg-[color-mix(in_oklab,var(--warning-soft)_70%,transparent)]",
                fresh && "animate-log-in",
              )}
            >
              <button
                type="button"
                disabled={!row.context}
                aria-expanded={row.context ? isOpen : undefined}
                onClick={() => setOpen(isOpen ? null : row.id)}
                className={cn(
                  "grid w-full grid-cols-[62px_44px_minmax(0,1fr)_14px] items-baseline gap-3 rounded-[inherit] border-0 bg-transparent px-2.5 py-1.5 text-left font-mono text-[12.5px] leading-[18px] text-foreground",
                  "cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  "not-disabled:hover:bg-[color-mix(in_oklab,var(--card)_80%,transparent)]",
                  isOpen && "bg-[color-mix(in_oklab,var(--card)_80%,transparent)]",
                  "@max-[520px]:grid-cols-[auto_minmax(0,1fr)_14px] @max-[520px]:gap-x-2.5 @max-[520px]:gap-y-0.5",
                )}
              >
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={row.timestamp}
                  title={row.timestamp}
                >
                  {row.time}
                </time>
                <span
                  className={cn("text-[11px] font-semibold tracking-[.06em]", LEVEL_TEXT[tone])}
                >
                  {row.level.toUpperCase()}
                </span>
                <span className="[overflow-wrap:anywhere] @max-[520px]:col-span-full @max-[520px]:row-start-2">
                  <Mark text={row.message} query={search} />
                </span>
                {row.context && (
                  <IconChevronDown
                    size={14}
                    stroke={ICON_STROKE}
                    aria-hidden
                    className={cn(
                      "self-center text-muted-foreground transition-transform duration-(--duration-base) @max-[520px]:col-start-3 @max-[520px]:row-start-1",
                      isOpen && "rotate-180",
                    )}
                  />
                )}
              </button>
              {isOpen && row.context && (
                <pre
                  className={cn(
                    "m-0 mr-2.5 mb-2 ml-[128px] animate-fade rounded-r-sm bg-card px-3 py-2.5 font-mono text-xs leading-[18px] whitespace-pre-wrap [overflow-wrap:anywhere] @max-[520px]:ml-2.5",
                    {
                      destructive: "shadow-[inset_2px_0_0_var(--destructive)]",
                      warning: "shadow-[inset_2px_0_0_var(--warning)]",
                      air: "shadow-[inset_2px_0_0_var(--air)]",
                      neutral: "shadow-[inset_2px_0_0_var(--muted-foreground)]",
                    }[tone],
                  )}
                >
                  <Mark text={row.context} query={search} />
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <Card className="min-w-0">
      <CardHeader
        legend={t("debug.logs.legend")}
        title={t("debug.serverLogs")}
        action={
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-pressed={!paused}
              onClick={togglePaused}
              title={paused ? t("debug.logs.resumeAutoRefresh") : t("debug.logs.pauseAutoRefresh")}
              className={cn(
                "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border-0 px-3 font-sans text-[13px] leading-4 font-medium",
                "transition-[background-color,color,scale] duration-(--duration-base) active:scale-97",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                paused ? "bg-warning-soft text-warning" : "bg-success-soft text-success",
              )}
            >
              {paused ? (
                <IconPlayerPause size={14} stroke={ICON_STROKE} aria-hidden />
              ) : (
                <Dot tone="success" pulse />
              )}
              <span>{paused ? t("debug.logs.paused") : t("debug.logs.live")}</span>
              {pending > 0 && (
                <span className="rounded-full bg-warning px-1.5 py-px font-mono text-xs font-semibold text-background">
                  +{pending}
                </span>
              )}
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              icon={IconRefresh}
              aria-label={t("debug.refresh")}
              title={t("debug.refresh")}
              loading={isFetching && !isLoading}
              onClick={() => void refetch()}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              icon={IconDownload}
              aria-label={t("debug.logs.download")}
              title={t("debug.logs.download")}
              loading={downloading}
              onClick={() => void download()}
            />
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t("debug.logs.searchPlaceholder")}
          className="min-w-[200px] flex-1"
        />
        <div
          role="radiogroup"
          aria-label={t("debug.logs.level")}
          className="flex gap-1.5 @max-[520px]:-mx-5 @max-[520px]:w-[calc(100%+40px)] @max-[520px]:flex-nowrap @max-[520px]:overflow-x-auto @max-[520px]:px-5 @max-[520px]:[scrollbar-width:none]"
        >
          {[
            { value: "all", label: t("debug.logs.all"), count: source.length },
            ...levels.map((value) => ({
              value,
              label: value.toUpperCase(),
              count: counts.get(value) ?? 0,
            })),
          ].map((chip) => {
            const on = level === chip.value;
            const tone = chip.value === "all" ? "all" : toneOf(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLevel(on || chip.value === "all" ? "all" : chip.value)}
                className={cn(
                  "inline-flex h-8 flex-none cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-muted px-2.5 font-mono text-[11px] leading-[14px] font-semibold tracking-[.06em] text-muted-foreground",
                  "transition-[background-color,color,box-shadow] duration-(--duration-fast) hover:text-foreground",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  on && "bg-card",
                  on && CHIP_ON[tone],
                )}
              >
                {chip.label}
                <span className="font-normal tracking-normal">{chip.count}</span>
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          {t("debug.logs.loadFailed", { message: error.message })}
        </Alert>
      )}
      <div className="grid h-[520px] min-h-40 overflow-hidden rounded-lg bg-muted max-md:h-[420px]">
        {body}
      </div>
      <p
        role="status"
        className="caption m-0 flex flex-wrap justify-between gap-x-4 gap-y-1 text-muted-foreground"
      >
        <span>
          {t("debug.logs.footer", {
            shown: shown.length,
            total: source.length,
            buffered: data?.bufferedCount ?? 0,
          })}
        </span>
        {paused && <span className="text-warning">{t("debug.logs.autoRefreshPaused")}</span>}
      </p>
    </Card>
  );
}
