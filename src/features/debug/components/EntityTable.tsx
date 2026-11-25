import { IconCategory, IconChevronDown } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Alert } from "@luftuj/shared/ui/alert";
import { Card } from "@luftuj/shared/ui/card";
import { CodeBlock } from "@luftuj/shared/ui/code-block";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { Dot } from "@luftuj/shared/ui/dot";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Mark, matchesSearch } from "@luftuj/shared/ui/mark";
import { SearchInput } from "@luftuj/shared/ui/search-input";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { cn } from "@luftuj/shared/utils/cn";

export interface HaEntity {
  entityId: string;
  domain: string;
  state: string;
  friendlyName: string;
  unit: string | null;
  deviceClass: string | null;
  attributes: Record<string, unknown>;
  lastChanged: string | null;
}

const ALL = "all";

/** LUFTaTOR's own: its valves (`number.luftator_…`) and what its MQTT discovery creates (`…luftuj_…`). */
export function isLuftatorEntity(entityId: string) {
  const objectId = entityId.slice(entityId.indexOf(".") + 1);
  return objectId.startsWith("luftator_") || objectId.startsWith("luftuj_");
}

type StateTone = "nil" | "off" | "on" | "";

function stateTone(state: string): StateTone {
  if (state === "unavailable" || state === "unknown") return "nil";
  if (state === "on" || state === "home") return "on";
  if (state === "off") return "off";
  return "";
}

interface EntityTableProps {
  entities: HaEntity[];
  loading?: boolean;
  error?: string | null;
}

/**
 * Every Home Assistant entity in one list: search (id or name, diacritics ignored), "Jen LUFTaTOR", a domain picker
 * with counts; a row opens its attributes. The header sticks while the list scrolls. Replaces HaEntitiesPage's table.
 */
export function EntityTable({ entities, loading, error }: Readonly<EntityTableProps>) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const [onlyOurs, setOnlyOurs] = useState(false);
  const [domain, setDomain] = useState(ALL);
  const [open, setOpen] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entity of entities) map.set(entity.domain, (map.get(entity.domain) ?? 0) + 1);
    return map;
  }, [entities]);
  const oursCount = useMemo(
    () => entities.filter((entity) => isLuftatorEntity(entity.entityId)).length,
    [entities],
  );

  const rows = entities.filter(
    (entity) =>
      (!onlyOurs || isLuftatorEntity(entity.entityId)) &&
      (domain === ALL || entity.domain === domain) &&
      (matchesSearch(entity.entityId, search) || matchesSearch(entity.friendlyName, search)),
  );

  const domainOptions = [
    { value: ALL, label: t("debug.haEntities.allDomains"), meta: String(entities.length) },
    ...[...counts.keys()]
      .toSorted((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name, mono: true, meta: String(counts.get(name)) })),
  ];

  let body;
  if (loading) {
    body = (
      <div className="grid justify-items-center p-6">
        <Spinner size={18} label={t("debug.haEntities.loading")} />
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="body m-0 p-6 text-center text-muted-foreground">
        {t("debug.haEntities.noMatches")}
      </p>
    );
  } else {
    body = rows.map((entity) => {
      const isOpen = open === entity.entityId;
      const tone = stateTone(entity.state);
      const ours = isLuftatorEntity(entity.entityId);
      const objectId = entity.entityId.slice(entity.domain.length + 1);
      return (
        <div key={entity.entityId} className="rounded-sm [&+&]:mt-px">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setOpen(isOpen ? null : entity.entityId)}
            className={cn(
              "grid min-h-10 w-full cursor-pointer grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.9fr)_14px] items-center gap-3 rounded-[inherit] border-0 bg-transparent px-2.5 py-1.5 text-left font-sans text-[13px] leading-[18px] text-foreground",
              "hover:bg-card focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              isOpen && "bg-card",
              "@max-[640px]:grid-cols-[minmax(0,1fr)_auto_14px] @max-[640px]:gap-x-2.5 @max-[640px]:gap-y-0.5 @max-[640px]:py-2",
            )}
          >
            <span className="font-mono text-xs [overflow-wrap:anywhere]">
              <span className="text-muted-foreground">{entity.domain}.</span>
              <span className={cn(ours && "font-medium text-air")}>
                <Mark text={objectId} query={search} />
              </span>
            </span>
            <span className="truncate @max-[640px]:col-span-full @max-[640px]:row-start-2 @max-[640px]:text-muted-foreground">
              <Mark text={entity.friendlyName} query={search} />
            </span>
            <span
              className={cn(
                "inline-flex min-w-0 items-baseline gap-1 font-mono text-[13px] @max-[640px]:col-start-2 @max-[640px]:row-start-1",
                tone === "nil" && "text-muted-foreground italic",
                tone === "off" && "text-muted-foreground",
              )}
            >
              {tone === "on" && <Dot tone="success" className="self-center" />}
              <span className="truncate">{entity.state}</span>
              {entity.unit && (
                <small className="text-[11px] text-muted-foreground">{entity.unit}</small>
              )}
            </span>
            <span className="caption truncate text-muted-foreground @max-[640px]:hidden">
              {entity.deviceClass ?? "—"}
            </span>
            <IconChevronDown
              size={14}
              stroke={ICON_STROKE}
              aria-hidden
              className={cn(
                "text-muted-foreground transition-transform duration-(--duration-base) @max-[640px]:col-start-3 @max-[640px]:row-start-1",
                isOpen && "rotate-180",
              )}
            />
          </button>
          {isOpen && (
            <div className="grid animate-fade gap-1.5 px-2.5 pt-1 pb-2.5">
              <CodeBlock
                label={t("debug.haEntities.attributes")}
                maxHeight={220}
                className="bg-card"
              >
                {JSON.stringify(entity.attributes ?? {}, null, 2)}
              </CodeBlock>
              {entity.lastChanged && (
                <span className="caption text-muted-foreground">
                  {t("debug.haEntities.lastChanged", {
                    time: new Date(entity.lastChanged).toLocaleString(i18n.language),
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder={t("debug.haEntities.searchPlaceholder")}
          className="min-w-[200px] flex-1"
        />
        <button
          type="button"
          aria-pressed={onlyOurs}
          onClick={() => setOnlyOurs(!onlyOurs)}
          className={cn(
            "inline-flex h-10 flex-none cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-muted px-2.5 font-mono text-[11px] leading-[14px] font-semibold tracking-[.06em] text-muted-foreground",
            "transition-[background-color,color,box-shadow] duration-(--duration-fast) hover:text-air",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            onlyOurs && "bg-card text-air shadow-[inset_0_0_0_1.5px_var(--air)]",
          )}
        >
          {t("debug.haEntities.onlyOurs")}
          <span className="font-normal tracking-normal">{oursCount}</span>
        </button>
        <Combobox
          aria-label={t("debug.haEntities.domain")}
          icon={IconCategory}
          options={domainOptions}
          value={domain}
          onValueChange={(value) => setDomain(value ?? ALL)}
          className="min-w-[180px] flex-[0_1_240px] @max-[640px]:flex-[1_1_100%]"
        />
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="grid max-h-[560px] grid-cols-[minmax(0,1fr)] overflow-auto overscroll-contain rounded-lg bg-muted px-1.5 pb-1.5">
        <div
          aria-hidden="true"
          className="legend sticky top-0 z-1 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,.9fr)_14px] gap-3 bg-muted px-2.5 pt-3 pb-2 @max-[640px]:hidden"
        >
          <span>{t("debug.haEntities.colEntity")}</span>
          <span>{t("debug.haEntities.colName")}</span>
          <span>{t("debug.haEntities.colState")}</span>
          <span>{t("debug.haEntities.colDeviceClass")}</span>
        </div>
        {body}
      </div>
      <p role="status" className="caption m-0 text-muted-foreground">
        {t("debug.haEntities.count", { shown: rows.length, total: entities.length })}
      </p>
    </Card>
  );
}
