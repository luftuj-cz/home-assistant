import { IconMinus, IconPlus } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { Legend } from "@luftuj/shared/ui/legend";
import { Switch } from "@luftuj/shared/ui/switch";
import { Well } from "@luftuj/shared/ui/well";
import { useMediaQuery } from "@luftuj/shared/utils/useMediaQuery";
import { cn } from "@luftuj/shared/utils/cn";

const RULER_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const RULER_LABELS: Record<number, string> = {
  5: "5",
  15: "15",
  30: "30",
  60: "1 h",
  120: "2 h",
  240: "4 h",
};
const TILE_PRESETS = [5, 15, 30, 60, 120];
const CUSTOM_MIN = 5;
const CUSTOM_MAX = 480;

/**
 * Minutes → [number, unit]: 35 → 35 min, 90 → 1,5 hodiny, 120 → 2 hodiny, 125 → 2 h 5 min, Infinity → ∞ do
 * zrušení. Decimal separator and plural follow the app's language.
 */
export function formatDuration(minutes: number, t: TFunction, language: string): [string, string] {
  if (!Number.isFinite(minutes)) return ["∞", t("dashboard.duration.untilCancelledUnit")];
  if (minutes < 60) return [String(minutes), t("dashboard.duration.min")];
  if (minutes % 60 === 0 || (minutes % 30 === 0 && minutes <= 180)) {
    const hours = minutes / 60;
    return [
      new Intl.NumberFormat(language).format(hours),
      t("dashboard.duration.hours", { count: hours }),
    ];
  }
  return [`${Math.floor(minutes / 60)} h ${minutes % 60}`, t("dashboard.duration.min")];
}

function endTime(minutes: number, now: number) {
  const end = new Date(now + minutes * 60_000);
  return `${end.getHours()}:${String(end.getMinutes()).padStart(2, "0")}`;
}

/** "Now" for the end times, refreshed every 30 s. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface DurationPickerProps {
  /** Minutes; Infinity = "Do zrušení". */
  value: number;
  onValueChange: (minutes: number) => void;
  /** `auto` follows the input type, not the width: tiles on a coarse pointer (touch), the ruler otherwise. */
  variant?: "auto" | "ruler" | "tiles";
  disabled?: boolean;
  className?: string;
}

/**
 * "Nastavit trvání" for the manual mode: one readout (big number and end time) with two input styles, a ruler for
 * the mouse and tiles for touch. The readout row has a fixed height, so changing the value never moves the controls.
 */
export function DurationPicker({
  value,
  onValueChange,
  variant = "auto",
  disabled,
  className,
}: Readonly<DurationPickerProps>) {
  const { t, i18n } = useTranslation();
  const coarse = useMediaQuery("(pointer: coarse)");
  const tiles = variant === "tiles" || (variant === "auto" && coarse);
  const now = useNow();
  const infinite = !Number.isFinite(value);
  const [lastFinite, setLastFinite] = useState(infinite ? 30 : value);
  useEffect(() => {
    if (Number.isFinite(value)) setLastFinite(value);
  }, [value]);
  const finite = infinite ? lastFinite : value;
  const [number, unit] = formatDuration(value, t, i18n.language);

  function toggleInfinite() {
    onValueChange(infinite ? lastFinite : Number.POSITIVE_INFINITY);
  }

  return (
    <Well
      aria-disabled={disabled || undefined}
      className={cn(
        "@container grid-cols-[minmax(0,1fr)] gap-4 p-5 max-[360px]:gap-3.5 max-[360px]:p-4",
        className,
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Legend>{t("dashboard.boostSetDuration")}</Legend>
        {!tiles && (
          <button
            type="button"
            aria-pressed={infinite}
            disabled={disabled}
            onClick={toggleInfinite}
            className={cn(
              "inline-flex h-8 flex-none cursor-pointer items-center gap-2 rounded-full bg-card pr-3 pl-2 font-sans text-[13px] leading-4 font-medium whitespace-nowrap text-muted-foreground",
              "shadow-[inset_0_0_0_1px_var(--border)] transition-colors duration-(--duration-base) hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
              "aria-pressed:bg-manual-soft aria-pressed:text-manual aria-pressed:shadow-[inset_0_0_0_1.5px_var(--manual)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-4 place-items-center rounded-full text-[10px] leading-none shadow-[inset_0_0_0_1.5px_currentColor]",
                infinite && "bg-manual text-manual-foreground shadow-none",
              )}
            >
              ∞
            </span>
            {t("dashboard.duration.untilCancelled")}
          </button>
        )}
      </div>

      <div aria-live="polite" className="flex h-[60px] min-w-0 items-baseline gap-2.5">
        <span
          className={cn(
            "readout-xl whitespace-nowrap",
            infinite && "text-[44px]",
            "@max-[300px]:text-5xl @max-[300px]:leading-[48px]",
          )}
        >
          {number}
        </span>
        <span
          className={cn(
            "code whitespace-nowrap text-muted-foreground",
            infinite && "@max-[300px]:hidden",
          )}
        >
          {unit}
        </span>
        <span className="ml-auto grid gap-0.5 text-right">
          <Legend>
            {infinite ? t("dashboard.duration.ends") : t("dashboard.duration.endsAt")}
          </Legend>
          <b className="font-sans text-lg leading-6 font-normal whitespace-nowrap tabular-nums">
            {infinite ? t("dashboard.duration.whenCancelled") : endTime(value, now)}
          </b>
        </span>
      </div>

      {tiles ? (
        <>
          <DurationTiles
            value={finite}
            infinite={infinite}
            disabled={disabled}
            now={now}
            onPick={onValueChange}
          />
          <div className="grid min-h-[52px] items-center rounded-md bg-card pr-1.5 pl-3.5 [&_[data-slot=switch][data-state=checked]]:bg-manual [&_[data-slot=switch][data-state=checked]]:shadow-none">
            <Switch
              label={t("dashboard.duration.untilCancelled")}
              description={t("dashboard.duration.runsUntilCancelled")}
              checked={infinite}
              disabled={disabled}
              onCheckedChange={toggleInfinite}
            />
          </div>
        </>
      ) : (
        <DurationRuler
          value={finite}
          infinite={infinite}
          disabled={disabled}
          onPick={onValueChange}
        />
      )}
    </Well>
  );
}

interface PartProps {
  value: number;
  infinite: boolean;
  disabled?: boolean;
  onPick: (minutes: number) => void;
}

/** Mouse: click or drag along the ruler (snaps to steps), or ← → / ↑ ↓ / Home / End. */
function DurationRuler({ value, infinite, disabled, onPick }: Readonly<PartProps>) {
  const { t, i18n } = useTranslation();
  const count = RULER_STEPS.length;
  const nearest = RULER_STEPS.reduce(
    (best, step, index) =>
      Math.abs(step - value) < Math.abs(RULER_STEPS[best] - value) ? index : best,
    0,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const off = disabled || infinite;

  function indexAt(x: number) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return nearest;
    return Math.round(Math.min(1, Math.max(0, (x - rect.left) / rect.width)) * (count - 1));
  }
  function position(index: number) {
    return `${(index / (count - 1)) * 100}%`;
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (off) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onPick(RULER_STEPS[indexAt(e.clientX)]);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (off) return;
    const index = indexAt(e.clientX);
    setHover(index);
    if (dragging && RULER_STEPS[index] !== value) onPick(RULER_STEPS[index]);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (off) return;
    const delta: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
    };
    let index: number | null = null;
    if (e.key in delta) index = Math.min(count - 1, Math.max(0, nearest + delta[e.key]));
    else if (e.key === "Home") index = 0;
    else if (e.key === "End") index = count - 1;
    if (index !== null) {
      e.preventDefault();
      onPick(RULER_STEPS[index]);
    }
  }

  function label(minutes: number) {
    return formatDuration(minutes, t, i18n.language).join(" ");
  }
  const transition = dragging ? "" : "transition-[width,left] duration-240 ease-(--ease-in-out)";

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={off ? -1 : 0}
      aria-label={t("dashboard.duration.label")}
      aria-disabled={off || undefined}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={nearest}
      aria-valuetext={infinite ? t("dashboard.duration.untilCancelledUnit") : label(value)}
      inert={infinite}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragging(false)}
      // A drag the system cancels (palm rejection, a gesture) or whose capture is lost must end too, or hovering
      // would keep picking durations.
      onPointerCancel={() => setDragging(false)}
      onLostPointerCapture={() => setDragging(false)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      className={cn(
        "group/ruler relative h-[72px] cursor-pointer touch-none outline-none select-none",
        infinite && "opacity-35",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="absolute inset-x-0 top-[18px] h-2 rounded-[4px] bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)]" />
      <span
        className={cn("absolute top-[18px] left-0 h-2 rounded-[4px] bg-manual", transition)}
        style={{ width: position(nearest) }}
      />
      {RULER_STEPS.map((step, index) => (
        <i
          key={step}
          className={cn(
            "absolute top-8 w-px -translate-x-[.5px]",
            RULER_LABELS[step] ? "h-2 bg-muted-foreground" : "h-[5px] bg-input",
          )}
          style={{ left: position(index) }}
        />
      ))}
      <span aria-hidden="true">
        {RULER_STEPS.map((step, index) =>
          RULER_LABELS[step] ? (
            <span
              key={step}
              className={cn(
                "absolute bottom-1.5 -translate-x-1/2 rounded-[4px] px-[5px] py-0.5 font-mono text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground",
                index === 0 && "-translate-x-[5px]",
                index === count - 1 && "-translate-x-[calc(100%-5px)]",
                index === nearest && !infinite && "font-semibold text-manual",
              )}
              style={{ left: position(index) }}
            >
              {RULER_LABELS[step]}
            </span>
          ) : null,
        )}
      </span>
      <span
        className={cn(
          "pointer-events-none absolute top-2 size-7 -translate-x-1/2 rounded-full bg-card shadow-[0_1px_2px_rgb(0_0_0/.18),0_0_0_2px_var(--manual)]",
          "group-focus-visible/ruler:shadow-[0_0_0_2px_var(--manual),0_0_0_5px_color-mix(in_oklab,var(--ring)_60%,transparent)]",
          transition,
        )}
        style={{ left: position(nearest) }}
      />
      {hover !== null && !dragging && !off && (
        <span
          className="pointer-events-none absolute -top-1.5 -translate-x-1/2 -translate-y-full rounded-[4px] bg-foreground px-1.5 py-0.5 font-mono text-[11px] font-medium whitespace-nowrap text-background"
          style={{ left: position(hover) }}
        >
          {label(RULER_STEPS[hover])}
        </span>
      )}
    </div>
  );
}

/** Touch: 5 / 15 / 30 min, 1 / 2 h and "Jiný" (a stepper, 5–480 min by 5); each preset shows its end time. */
function DurationTiles({
  value,
  infinite,
  disabled,
  now,
  onPick,
}: Readonly<PartProps & { now: number }>) {
  const { t, i18n } = useTranslation();
  const [other, setOther] = useState(!TILE_PRESETS.includes(value));
  const off = disabled || infinite;
  const [number, unit] = formatDuration(value, t, i18n.language);
  const tile = cn(
    "grid min-h-16 cursor-pointer content-center justify-items-start gap-0.5 rounded-md bg-card px-3 py-2.5 text-left text-foreground",
    "transition-[background-color,box-shadow] duration-(--duration-fast) [-webkit-tap-highlight-color:transparent]",
    "hover:not-disabled:data-[state=off]:shadow-[inset_0_0_0_1px_var(--border)]",
    "data-[state=on]:bg-manual-soft data-[state=on]:shadow-[inset_0_0_0_2px_var(--manual)]",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
  );

  return (
    <>
      <div
        role="radiogroup"
        aria-label={t("dashboard.duration.label")}
        inert={infinite}
        className={cn("grid grid-cols-3 gap-2 @max-[300px]:grid-cols-2", infinite && "opacity-35")}
      >
        {TILE_PRESETS.map((minutes) => {
          const on = !other && value === minutes;
          return (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={on}
              data-state={on ? "on" : "off"}
              disabled={off}
              onClick={() => {
                setOther(false);
                onPick(minutes);
              }}
              className={tile}
            >
              <b
                className={cn(
                  "font-sans text-lg leading-[22px] font-medium tabular-nums",
                  on && "text-manual",
                )}
              >
                {minutes < 60 ? minutes : minutes / 60}
                <small
                  className={cn(
                    "ml-[3px] font-mono text-xs font-normal text-muted-foreground",
                    on && "text-manual",
                  )}
                >
                  {minutes < 60 ? "min" : "h"}
                </small>
              </b>
              <span className="font-sans text-xs leading-4 whitespace-nowrap text-muted-foreground tabular-nums">
                {t("dashboard.duration.untilTime", { time: endTime(minutes, now) })}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={other}
          data-state={other ? "on" : "off"}
          disabled={off}
          onClick={() => setOther(true)}
          className={tile}
        >
          <b
            className={cn(
              "font-sans text-[15px] leading-[22px] font-medium",
              other && "text-manual",
            )}
          >
            {t("dashboard.duration.other")}
          </b>
          <span className="font-sans text-xs leading-4 whitespace-nowrap text-muted-foreground">
            {t("dashboard.duration.every5")}
          </span>
        </button>
      </div>
      {other && (
        <div
          inert={infinite}
          className={cn(
            "flex items-center gap-2 rounded-md bg-card p-1.5",
            infinite && "opacity-35",
          )}
        >
          <button
            type="button"
            aria-label={t("dashboard.duration.shorter")}
            disabled={off || value <= CUSTOM_MIN}
            onClick={() => onPick(Math.max(CUSTOM_MIN, value - 5))}
            className="grid size-12 flex-none cursor-pointer place-items-center rounded-[calc(var(--radius-md)-2px)] bg-muted text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconMinus size={20} stroke={ICON_STROKE} aria-hidden />
          </button>
          <output className="flex-1 text-center font-sans text-xl tabular-nums">
            {number}
            <small className="ml-1 font-mono text-xs text-muted-foreground">{unit}</small>
          </output>
          <button
            type="button"
            aria-label={t("dashboard.duration.longer")}
            disabled={off || value >= CUSTOM_MAX}
            onClick={() => onPick(Math.min(CUSTOM_MAX, value + 5))}
            className="grid size-12 flex-none cursor-pointer place-items-center rounded-[calc(var(--radius-md)-2px)] bg-muted text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconPlus size={20} stroke={ICON_STROKE} aria-hidden />
          </button>
        </div>
      )}
    </>
  );
}
