import { IconCheck, IconChevronDown, IconCopy, IconDownload } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useBackendSnapshot,
  useHomeAssistantSnapshot,
} from "@luftuj/features/debug/hooks/useDebugData";
import { useDownloadDebugJson } from "@luftuj/features/debug/hooks/useDownloadDebugJson";
import { flattenDebugRows, type DebugRow } from "@luftuj/features/debug/utils";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardHeader } from "@luftuj/shared/ui/card";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { Dot } from "@luftuj/shared/ui/dot";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Mark, matchesSearch } from "@luftuj/shared/ui/mark";
import { SearchInput } from "@luftuj/shared/ui/search-input";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { ToggleGroup } from "@luftuj/shared/ui/toggle-group";
import { writeTextToClipboard } from "@luftuj/shared/utils/clipboard";
import { cn } from "@luftuj/shared/utils/cn";
import { createLogger } from "@luftuj/shared/utils/logger";
import { useMediaQuery } from "@luftuj/shared/utils/useMediaQuery";

const logger = createLogger("Inspector");

type Source = "backend" | "home-assistant";

const DOWNLOAD: Record<Source, { endpoint: string; prefix: string }> = {
  backend: { endpoint: "/api/debug/download", prefix: "luftator-debug" },
  "home-assistant": { endpoint: "/api/debug/home-assistant/download", prefix: "luftator-ha-api" },
};

/** On a phone, groups longer than this start collapsed, so the page is not forty rows before the next card. */
const LONG_GROUP = 8;

interface Group {
  name: string;
  rows: (DebugRow & { rest: string })[];
}

/** By the first segment of the key, in the order the (sorted) keys come. */
function groupRows(rows: DebugRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const dot = row.key.indexOf(".");
    const name = dot < 0 ? "" : row.key.slice(0, dot);
    let group = groups.find((entry) => entry.name === name);
    if (!group) {
      group = { name, rows: [] };
      groups.push(group);
    }
    group.rows.push({ ...row, rest: dot < 0 ? row.key : row.key.slice(dot + 1) });
  }
  return groups;
}

/** A group's height in rows, its heading counted as two. */
function weight(group: Group) {
  return group.rows.length + 2;
}

/** Two balanced columns, filled in order, so the reading order survives when they stack. */
function balance(groups: Group[]): [Group[], Group[]] {
  const half = groups.reduce((sum, group) => sum + weight(group), 0) / 2;
  const columns: [Group[], Group[]] = [[], []];
  let acc = 0;
  for (const group of groups) {
    const first = acc + weight(group) / 2 <= half || columns[0].length === 0;
    columns[first ? 0 : 1].push(group);
    acc += weight(group);
  }
  return columns;
}

/** `true` gets a green dot; `false`, `null` and empty are dimmed. */
function valueKind(value: string): "true" | "nil" | "" {
  if (value === "true") return "true";
  if (value === "false" || value === "null" || value === "undefined" || value === "") return "nil";
  return "";
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), intervalMs);
    return () => globalThis.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * The backend's (or Home Assistant API's) state as flat key/value rows, grouped by the key's first segment, with
 * search, copy and download. A value that changed since the last refresh flashes once. Keys stay in English.
 * Replaces BackendValuesPanel and HomeAssistantApiPanel.
 */
export function Inspector() {
  const { t, i18n } = useTranslation();
  const [source, setSource] = useState<Source>("backend");
  const backend = useBackendSnapshot();
  const homeAssistant = useHomeAssistantSnapshot(source === "home-assistant");
  const query = source === "backend" ? backend : homeAssistant;
  const rows = useMemo(() => flattenDebugRows(query.data ?? null), [query.data]);
  const [search, setSearch] = useState("");
  const phone = useMediaQuery("(max-width: 560px)");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const { downloading, download } = useDownloadDebugJson(logger, t);
  const now = useNow(1000);

  // Which values changed at the last refresh: a counter per key, so the value's span remounts and flashes again.
  const previous = useRef<Map<string, string>>(new Map());
  const [flashes, setFlashes] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const before = previous.current;
    const changed: string[] = [];
    for (const row of rows) {
      const id = `${source}:${row.key}`;
      if (before.has(id) && before.get(id) !== row.value) changed.push(id);
      before.set(id, row.value);
    }
    if (changed.length > 0) {
      setFlashes((current) => {
        const next = new Map(current);
        for (const id of changed) next.set(id, (next.get(id) ?? 0) + 1);
        return next;
      });
    }
  }, [rows, source]);

  const shown = rows.filter(
    (row) => matchesSearch(row.key, search) || matchesSearch(row.value, search),
  );
  const groups = groupRows(shown);
  const columns = balance(groups);

  function isOpen(group: Group) {
    if (search.trim()) return true;
    const collapsedByDefault = phone && group.rows.length > LONG_GROUP;
    return toggled[group.name] === undefined ? !collapsedByDefault : toggled[group.name];
  }

  function flashCopied(id: string) {
    setCopied(id);
    globalThis.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1400);
  }

  async function copy(id: string, text: string) {
    try {
      await writeTextToClipboard(text);
      flashCopied(id);
    } catch (error) {
      logger.error("Clipboard copy failed", { error });
    }
  }

  const capturedAt =
    typeof query.data?.capturedAt === "string" ? new Date(query.data.capturedAt) : null;
  const ageSeconds = capturedAt
    ? Math.max(0, Math.round((now - capturedAt.getTime()) / 1000))
    : null;
  let age: string | null = null;
  if (ageSeconds !== null) {
    age =
      ageSeconds < 60
        ? t("app.unit.ageSeconds", { count: ageSeconds })
        : t("app.unit.ageMinutes", { count: Math.floor(ageSeconds / 60) });
  }

  let body;
  if (query.isLoading) {
    body = (
      <div className="grid justify-items-center p-6">
        <Spinner
          size={18}
          label={source === "backend" ? t("debug.loading") : t("debug.haApi.loading")}
        />
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <p className="body m-0 p-6 text-center text-muted-foreground">
        {search.trim() ? t("debug.inspector.noMatches") : t("debug.noData")}
      </p>
    );
  } else {
    body = (
      <div className="grid grid-cols-2 items-start gap-x-6 gap-y-4 @max-[760px]:grid-cols-[minmax(0,1fr)]">
        {columns.map((column, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)] gap-4 empty:hidden">
            {column.map((group) => {
              const open = isOpen(group);
              return (
                <section key={group.name} className="grid grid-cols-[minmax(0,1fr)]">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setToggled((current) => ({ ...current, [group.name]: !open }))}
                    className="group/kv flex w-full cursor-pointer items-center gap-2 border-0 border-b border-solid border-border bg-transparent px-1 py-2 text-left text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <IconChevronDown
                      size={14}
                      stroke={ICON_STROKE}
                      aria-hidden
                      className={cn(
                        "text-muted-foreground transition-transform duration-(--duration-base)",
                        !open && "-rotate-90",
                      )}
                    />
                    <span className="legend flex-1 text-foreground group-hover/kv:text-air">
                      {group.name || t("debug.inspector.general")}
                    </span>
                    <span className="code text-muted-foreground">{group.rows.length}</span>
                  </button>
                  <Collapse open={open}>
                    <div className="grid pt-1">
                      {group.rows.map((row) => {
                        const parts = row.rest.split(".");
                        const last = parts.pop() ?? "";
                        const id = `${source}:${row.key}`;
                        const flash = flashes.get(id) ?? 0;
                        const kind = valueKind(row.value);
                        return (
                          <div
                            key={row.key}
                            className="group/row grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)_28px] items-start gap-3 rounded-sm px-1 py-[5px] hover:bg-muted @max-[420px]:grid-cols-[minmax(0,1fr)_28px] @max-[420px]:gap-x-2 @max-[420px]:gap-y-0"
                          >
                            <span className="code leading-5 font-medium [overflow-wrap:anywhere] @max-[420px]:font-normal @max-[420px]:text-muted-foreground">
                              {parts.length > 0 && (
                                <span className="font-normal text-muted-foreground">{`${parts.join(".")}.`}</span>
                              )}
                              <Mark text={last} query={search} />
                            </span>
                            <span
                              key={flash}
                              className={cn(
                                "code flex items-baseline gap-2 rounded-[4px] leading-5 [overflow-wrap:anywhere] @max-[420px]:col-start-1 @max-[420px]:row-start-2",
                                kind === "nil" && "text-muted-foreground",
                                flash > 0 && "animate-value-flash",
                              )}
                            >
                              {kind === "true" && (
                                <Dot tone="success" className="flex-none self-center" />
                              )}
                              <Mark text={row.value === "" ? "—" : row.value} query={search} />
                            </span>
                            <button
                              type="button"
                              aria-label={t("debug.inspector.copyKey", { key: row.key })}
                              title={t("debug.copy")}
                              onClick={() => void copy(id, row.value)}
                              className={cn(
                                "grid h-5 w-7 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-muted-foreground opacity-0 transition-opacity duration-(--duration-fast)",
                                "group-hover/row:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:opacity-100",
                                "@max-[420px]:row-span-2 @max-[420px]:h-7 @max-[420px]:self-center",
                                copied === id && "text-success opacity-100",
                              )}
                            >
                              {copied === id ? (
                                <IconCheck size={14} stroke={ICON_STROKE} aria-hidden />
                              ) : (
                                <IconCopy size={14} stroke={ICON_STROKE} aria-hidden />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </Collapse>
                </section>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  const copyAllId = `all:${source}`;
  let error: string | null = null;
  if (query.error) {
    error = t(source === "backend" ? "debug.loadFailed" : "debug.haApi.loadFailed", {
      message: query.error.message,
    });
  }

  return (
    <Card className="min-w-0">
      <CardHeader
        legend={age ? `${t("debug.inspector.legend")} · ${age}` : t("debug.inspector.legend")}
        title={t("debug.inspector.title")}
        action={
          <span className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              icon={copied === copyAllId ? IconCheck : IconCopy}
              aria-label={t("debug.copyValues")}
              title={t("debug.copyValues")}
              disabled={!query.data}
              className={copied === copyAllId ? "text-success" : undefined}
              onClick={() => void copy(copyAllId, JSON.stringify(query.data, null, 2))}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              icon={IconDownload}
              aria-label={t("debug.downloadValues")}
              title={t("debug.downloadValues")}
              loading={downloading}
              onClick={() => void download(DOWNLOAD[source].endpoint, DOWNLOAD[source].prefix)}
            />
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          items={[
            { value: "backend", label: t("debug.inspector.backend") },
            { value: "home-assistant", label: t("debug.homeAssistantApi") },
          ]}
          value={source}
          onValueChange={(value) => setSource(value as Source)}
          aria-label={t("debug.inspector.source")}
          full={phone}
        />
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t("debug.inspector.searchPlaceholder")}
          className="min-w-[200px] flex-1 max-[560px]:basis-full"
        />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {body}
      <p role="status" className="caption m-0 text-muted-foreground">
        {t("debug.inspector.footer", { shown: shown.length, total: rows.length })}
        {capturedAt &&
          ` · ${t("debug.inspector.updated", { time: capturedAt.toLocaleTimeString(i18n.language, { hour12: false }) })}`}
      </p>
    </Card>
  );
}
