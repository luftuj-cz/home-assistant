import { IconMinus, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { useFieldControl, type FieldControlProps } from "./field-context";
import { ICON_STROKE } from "./icon-types";

interface NumberInputProps extends FieldControlProps {
  value?: number | null;
  defaultValue?: number | null;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  invalid?: boolean;
  disabled?: boolean;
  onValueChange?: (value: number) => void;
  className?: string;
}

function clampRound(n: number, min: number, max: number) {
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}

/**
 * A bounded number with − / + and a unit. Typing keeps the raw text (a decimal comma or point is fine); the value is
 * clamped and applied on blur or Enter. ↑ / ↓ step it. The − / + tiles are for mouse and touch only (not tabbable).
 */
export function NumberInput({
  value,
  defaultValue = 0,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  unit,
  invalid,
  disabled,
  onValueChange,
  className,
  ...props
}: Readonly<NumberInputProps>) {
  const { t } = useTranslation();
  const field = useFieldControl({ ...props, invalid });
  const [inner, setInner] = useState<number | null>(defaultValue);
  const [text, setText] = useState<string | null>(null);
  const current = value === undefined ? inner : value;

  function set(n: number) {
    const next = clampRound(n, min, max);
    setInner(next);
    setText(null);
    onValueChange?.(next);
  }

  function stepBy(delta: number) {
    set(current === null ? Math.max(min, 0) : current + delta);
  }

  function commit() {
    if (text === null) {
      return;
    }
    const n = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(n)) {
      set(n);
    } else {
      setText(null);
    }
  }

  const shown = text ?? (current === null ? "" : String(current));
  const tile =
    "grid size-9 flex-none cursor-pointer place-items-center rounded-[calc(var(--radius-md)-4px)] text-foreground transition-[background-color,scale] duration-(--duration-fast) hover:not-disabled:bg-accent active:not-disabled:scale-[.94] disabled:cursor-not-allowed disabled:opacity-35";

  return (
    <div
      data-slot="number-input"
      data-disabled={disabled || undefined}
      className={cn(
        "flex h-11 items-center gap-1 rounded-md bg-muted p-1 shadow-[inset_0_0_0_1px_var(--border)]",
        "transition-[box-shadow,background-color] duration-(--duration-fast)",
        "focus-within:bg-card focus-within:shadow-[inset_0_0_0_2px_var(--ring)]",
        field["aria-invalid"] && "shadow-[inset_0_0_0_2px_var(--destructive)]",
        "data-disabled:opacity-55",
        className,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("ui.decrease")}
        disabled={disabled || (current !== null && current <= min)}
        onClick={() => stepBy(-step)}
        className={tile}
      >
        <IconMinus size={16} stroke={ICON_STROKE} aria-hidden />
      </button>
      <span className="flex min-w-0 flex-1 items-baseline justify-center gap-1">
        <input
          {...field}
          inputMode="decimal"
          value={shown}
          placeholder="—"
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              stepBy(step);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              stepBy(-step);
            }
          }}
          style={{ width: `${Math.max(1, shown.length)}ch` }}
          className="box-content max-w-full min-w-[1ch] bg-transparent p-0 text-center font-mono text-lg leading-6 text-foreground tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed pointer-coarse:text-lg"
        />
        {unit && (
          <span aria-hidden="true" className="font-mono text-[13px] text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("ui.increase")}
        disabled={disabled || (current !== null && current >= max)}
        onClick={() => stepBy(step)}
        className={tile}
      >
        <IconPlus size={16} stroke={ICON_STROKE} aria-hidden />
      </button>
    </div>
  );
}
