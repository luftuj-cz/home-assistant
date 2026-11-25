import { useDraggable } from "@dnd-kit/core";
import {
  IconAlertTriangle,
  IconCopy,
  IconGripVertical,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";

import { modeNumber } from "@luftuj/features/timeline/utils";
import type { Mode } from "@luftuj/shared/types/timeline";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { Tooltip, TooltipContent, TooltipTrigger } from "@luftuj/shared/ui/tooltip";
import { cn } from "@luftuj/shared/utils/cn";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";

export const MODE_DRAG_PREFIX = "mode:";

interface ModeCardProps {
  mode: Mode;
  powerUnit: string;
  onEdit: (mode: Mode) => void;
  /** Omitted where modes cannot be created, e.g. on a custom timeline. */
  onDuplicate?: (mode: Mode) => void;
  onDelete: (mode: Mode) => void;
  /** The lifted copy under the pointer (DragOverlay). */
  dragging?: boolean;
  /** Hides the card in the grid while its copy is dragged. */
  placeholder?: boolean;
  rootRef?: Ref<HTMLDivElement>;
  dragProps?: Record<string, unknown>;
  /** Shows the grip and takes touch for dragging; off on phones, where no day is in reach. */
  draggable?: boolean;
}

/**
 * A schedule mode (replaces the TimelineModeList card): colour, name on up to two lines, values, and Upravit,
 * Duplikovat, Smazat at the bottom right. Drag it onto a day to plan it. A mode with no values in the viewed season
 * is "Nenastaveno": outlined, not draggable, and its edit button sets the values.
 */
export function ModeCard({
  mode,
  powerUnit,
  onEdit,
  onDuplicate,
  onDelete,
  dragging,
  placeholder,
  rootRef,
  dragProps,
  draggable = true,
}: Readonly<ModeCardProps>) {
  const { t } = useTranslation();
  const temperatureUnit = useTemperature();
  // `false`: the mode exists here but has no values for this season. `undefined`: no season applies.
  const unconfigured = mode.configured === false;
  const canDrag = draggable && !unconfigured;
  const power = modeNumber(mode, "power");
  const temperature = modeNumber(mode, "temperature");
  const unit = t(`app.units.${powerUnit}`, { defaultValue: powerUnit });
  const editLabel = unconfigured
    ? t("settings.timeline.modeConfigureAction")
    : t("settings.timeline.edit");

  const edit = (
    <Button
      variant={unconfigured ? "secondary" : "ghost"}
      size="icon-sm"
      icon={IconPencil}
      aria-label={editLabel}
      onClick={() => onEdit(mode)}
    />
  );

  return (
    <div
      ref={rootRef}
      data-slot="mode-card"
      data-unconfigured={unconfigured || undefined}
      data-dragging={dragging || undefined}
      {...(canDrag ? dragProps : {})}
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)] content-between gap-3 rounded-lg bg-card p-4 shadow-plane",
        canDrag && "cursor-grab touch-none",
        "transition-[translate,box-shadow,background-color] duration-(--duration-base) ease-(--ease-out)",
        "pointer-fine:hover:not-data-unconfigured:-translate-y-0.5 pointer-fine:hover:not-data-unconfigured:shadow-float",
        "data-unconfigured:cursor-not-allowed data-unconfigured:bg-transparent data-unconfigured:shadow-[inset_0_0_0_1.5px_var(--border)]",
        "data-dragging:rotate-[-1.5deg] data-dragging:cursor-grabbing data-dragging:shadow-float",
        placeholder && "invisible",
      )}
    >
      <div className="grid gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1 size-3.5 flex-none rounded-[4px]"
            style={{ background: mode.color ?? "var(--mode-8)" }}
          />
          <p
            className="card-title line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere]"
            title={mode.name}
          >
            {mode.name}
          </p>
          {canDrag && (
            <IconGripVertical
              size={16}
              stroke={ICON_STROKE}
              aria-hidden
              className="mt-0.5 flex-none text-input"
            />
          )}
        </div>
        {(unconfigured || mode.isBoost) && (
          <div className="flex flex-wrap gap-1.5">
            {unconfigured && (
              <Badge variant="warning" icon={IconAlertTriangle}>
                {t("settings.timeline.modeUnconfigured")}
              </Badge>
            )}
            {mode.isBoost && (
              <Badge variant="manual">{t("settings.timeline.modeIsBoostBadge")}</Badge>
            )}
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-end gap-4">
          {!unconfigured && power != null && (
            <span className="grid gap-0.5">
              <Legend>{t("settings.timeline.modePower")}</Legend>
              <span className="readout-sm">
                {power}
                <small className="text-xs text-muted-foreground"> {unit}</small>
              </span>
            </span>
          )}
          {!unconfigured && temperature != null && (
            <span className="grid gap-0.5">
              <Legend>{t("settings.timeline.modeTemperature")}</Legend>
              <span className="readout-sm">
                {temperatureUnit.show(temperature).toFixed(1)}
                <small className="text-xs text-muted-foreground"> {temperatureUnit.label}</small>
              </span>
            </span>
          )}
          {unconfigured && (
            <span className="caption text-muted-foreground">
              {t("settings.timeline.eventModeUnconfigured")}
            </span>
          )}
        </div>
        <span className="flex flex-none" onPointerDown={(event) => event.stopPropagation()}>
          {unconfigured ? (
            <Tooltip>
              <TooltipTrigger asChild>{edit}</TooltipTrigger>
              <TooltipContent wrap>{t("settings.timeline.modeUnconfiguredHint")}</TooltipContent>
            </Tooltip>
          ) : (
            edit
          )}
          {onDuplicate && (
            <Button
              variant="ghost"
              size="icon-sm"
              icon={IconCopy}
              aria-label={t("settings.timeline.duplicate")}
              onClick={() => onDuplicate(mode)}
            />
          )}
          <Button
            variant="danger-ghost"
            size="icon-sm"
            icon={IconTrash}
            aria-label={t("settings.timeline.delete")}
            onClick={() => onDelete(mode)}
          />
        </span>
      </div>
    </div>
  );
}

/** A ModeCard that can be dragged onto a day; one with no values here cannot. */
export function DraggableModeCard(props: Readonly<Omit<ModeCardProps, "rootRef" | "dragProps">>) {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `${MODE_DRAG_PREFIX}${props.mode.id}`,
    data: { mode: props.mode },
    disabled: props.mode.configured === false || props.draggable === false,
  });
  return (
    <ModeCard
      {...props}
      rootRef={setNodeRef}
      // Pointer only: dnd-kit's role="button" and tabIndex would wrap the card's own buttons in another control.
      // Keyboard users add events with a day's "+" instead.
      dragProps={{ onPointerDown: listeners?.onPointerDown }}
      placeholder={isDragging}
    />
  );
}
