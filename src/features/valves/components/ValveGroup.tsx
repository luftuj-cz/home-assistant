import { IconChevronDown } from "@tabler/icons-react";
import { useId, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { useTranslation } from "react-i18next";

import type { Valve } from "@luftuj/shared/types/valve";
import { Button } from "@luftuj/shared/ui/button";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { DamperDial } from "@luftuj/shared/ui/damper-dial";
import { damperAngle, damperState } from "@luftuj/shared/ui/damper-geometry";
import { Legend } from "@luftuj/shared/ui/legend";
import { Slider } from "@luftuj/shared/ui/slider";
import { damperScale, getValveGroupBounds } from "@luftuj/shared/utils/valve";

import { ValveCard } from "./ValveCard";

interface BulkProps {
  name: string;
  valves: Valve[];
  onPreview: (entityId: string, value: number) => void;
  onCommit: (value: number) => void | Promise<void>;
}

/** "Nastavit vše": one pointer slider for the whole group; "Různé" while the dampers differ. */
function BulkControl({ name, valves, onPreview, onCommit }: Readonly<BulkProps>) {
  const { t } = useTranslation();
  const bounds = getValveGroupBounds(valves);
  const mixed = valves.some((valve) => valve.value !== valves[0].value);
  // A drag makes them equal, so the readout follows the slider without extra state.
  const [dragging, setDragging] = useState<number | null>(null);
  const middle = (bounds.min + bounds.max) / 2;
  const value = dragging ?? (mixed ? middle : valves[0].value);
  const showMixed = mixed && dragging === null;
  const offline = valves.some((valve) => !valve.isAvailable);
  const state = showMixed ? "partial" : damperState(value, bounds.min, bounds.max);

  return (
    <div className="grid gap-2 rounded-xl bg-card px-5 py-4 shadow-plane [--dm-ground:var(--card)]">
      <div className="flex items-center gap-3">
        <DamperDial
          angle={showMixed ? 45 : damperAngle(value, bounds.min, bounds.max)}
          state={offline ? "offline" : state}
          size={36}
        />
        <Legend>{t("valves.groups.bulkSetValue")}</Legend>
        <span className="ml-auto readout-sm">
          {showMixed ? t("valves.groups.mixedValues") : `${Math.round(value)}°`}
        </span>
      </div>
      <Slider
        value={value}
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        disabled={offline}
        fill="none"
        tone="air"
        ticks={6}
        labels={damperScale(t, bounds.min, bounds.max)}
        format={(v) => `${v}°`}
        aria-label={t("valves.groups.bulkAria", { name })}
        onValueChange={(v) => {
          setDragging(v);
          for (const valve of valves) onPreview(valve.entityId, v);
        }}
        onValueCommit={(v) => {
          setDragging(null);
          void onCommit(v);
        }}
      />
      {offline && <p className="caption text-muted-foreground">{t("valves.groups.someOffline")}</p>}
    </div>
  );
}

interface ValveGroupProps {
  name: string;
  valves: Valve[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onPreview: (entityId: string, value: number) => void;
  onCommit: (entityId: string, value: number) => void | Promise<void>;
  /** Writes one value to the whole group; without it there is no "Nastavit vše" (ungrouped dampers). */
  onBulkCommit?: (value: number) => void | Promise<void>;
  /** The reorder grip (SortableGrip), for saved groups. */
  grip?: ReactNode;
  rootRef?: Ref<HTMLElement>;
  style?: CSSProperties;
  dragging?: boolean;
}

/**
 * A named group of dampers: the count, the title, a grip to reorder and Sbalit/Rozbalit, then "Nastavit vše" and a
 * card per damper. Ungrouped dampers use the same section titled "Bez skupiny", without the grip and bulk control.
 */
export function ValveGroup({
  name,
  valves,
  collapsed,
  onCollapsedChange,
  onPreview,
  onCommit,
  onBulkCommit,
  grip,
  rootRef,
  style,
  dragging,
}: Readonly<ValveGroupProps>) {
  const { t } = useTranslation();
  const contentId = useId();

  return (
    <section
      ref={rootRef}
      style={style}
      aria-label={name}
      data-dragging={dragging || undefined}
      className="@container relative grid grid-cols-[minmax(0,1fr)] rounded-xl data-dragging:z-10 data-dragging:bg-background data-dragging:shadow-float"
    >
      <header className="flex items-end gap-3">
        {grip}
        <div className="grid min-w-0 flex-1 gap-1">
          <Legend>{t("valves.groups.valveCount", { count: valves.length })}</Legend>
          <h2 className="section-title truncate">{name}</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onClick={() => onCollapsedChange(!collapsed)}
          className="[&>svg:last-child]:transition-[rotate] [&>svg:last-child]:duration-(--duration-base) aria-[expanded=false]:[&>svg:last-child]:-rotate-90"
          iconRight={IconChevronDown}
        >
          {collapsed ? t("valves.groups.expand") : t("valves.groups.collapse")}
        </Button>
      </header>
      <Collapse open={!collapsed}>
        <div id={contentId} className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-4">
          {onBulkCommit && valves.length > 0 && (
            <BulkControl
              name={name}
              valves={valves}
              onPreview={onPreview}
              onCommit={onBulkCommit}
            />
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4 @max-[300px]:grid-cols-[minmax(0,1fr)]">
            {valves.map((valve, index) => (
              <div
                key={valve.entityId}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)] animate-rise"
                style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
              >
                <ValveCard valve={valve} onPreview={onPreview} onCommit={onCommit} />
              </div>
            ))}
          </div>
        </div>
      </Collapse>
    </section>
  );
}
