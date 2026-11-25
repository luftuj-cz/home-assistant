import { IconClock } from "@tabler/icons-react";
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { useFieldControl, type FieldControlProps } from "./field-context";
import { ICON_STROKE } from "./icon-types";

interface TimeFieldProps extends FieldControlProps {
  /** "HH:MM". */
  value?: string;
  defaultValue?: string;
  onValueChange?: (time: string) => void;
  /** Minutes per ↑ / ↓ step (15 in the event dialog). Hours always step by 1. */
  step?: number;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

type Part = "h" | "m";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * A time as two mono segments, HH : MM. Focus selects a segment; two typed digits fill it and move on, and a digit
 * that cannot start a valid value (3–9 in hours, 6–9 in minutes) is taken at once. ↑ / ↓ step. Backspace clears the
 * segment; leaving it empty keeps the old value.
 */
export function TimeField({
  value,
  defaultValue = "08:00",
  onValueChange,
  step = 1,
  invalid,
  disabled,
  "aria-label": ariaLabel,
  className,
  ...props
}: Readonly<TimeFieldProps>) {
  const { t } = useTranslation();
  const field = useFieldControl({ ...props, invalid });
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const [h, m] = current.split(":").map(Number);
  const [edit, setEditState] = useState<{ part: Part; text: string } | null>(null);
  const editRef = useRef<{ part: Part; text: string } | null>(null);
  const minutesRef = useRef<HTMLInputElement>(null);

  function setEdit(next: { part: Part; text: string } | null) {
    editRef.current = next;
    setEditState(next);
  }

  function set(hours: number, minutes: number) {
    const next = `${pad((hours + 24) % 24)}:${pad((minutes + 60) % 60)}`;
    setInner(next);
    onValueChange?.(next);
  }

  function commit(part: Part, typed: string) {
    const n = Number.parseInt(typed, 10);
    if (Number.isFinite(n)) {
      if (part === "h") {
        set(Math.min(23, n), m);
      } else {
        set(h, Math.min(59, n));
      }
    }
    setEdit(null);
  }

  /** One typed digit: two fill the segment, and a digit no valid value can start with is taken at once. */
  function typeDigit(part: Part, digit: string) {
    const prev = editRef.current;
    const typed = (prev?.part === part ? prev.text : "") + digit;
    setEdit({ part, text: typed });
    if (typed.length === 2 || Number.parseInt(typed, 10) > (part === "h" ? 2 : 5)) {
      commit(part, typed);
      if (part === "h") {
        minutesRef.current?.focus();
      }
    }
  }

  function onKeyDown(part: Part, e: KeyboardEvent<HTMLInputElement>) {
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      typeDigit(part, e.key);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      setEdit({ part, text: "" });
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      // A half-typed digit would otherwise be committed on blur and undo the step.
      setEdit(null);
      const up = e.key === "ArrowUp";
      if (part === "h") {
        set(h + (up ? 1 : -1), m);
      } else {
        set(h, Math.round((m + (up ? step : -step)) / step) * step);
      }
    }
  }

  /**
   * Text that reached the field without a usable keydown: Android keyboards report digits as "Unidentified", and
   * IMEs and paste do not send key events at all. Whatever was inserted is fed through the same digit logic.
   */
  function onInput(part: Part, e: ChangeEvent<HTMLInputElement>) {
    const pending = editRef.current;
    const shown = pending?.part === part ? pending.text : pad(part === "h" ? h : m);
    const next = e.target.value;
    // What was typed. Some IMEs leave `data` empty; then it is whatever follows the text that was shown.
    let inserted = (e.nativeEvent as InputEvent).data ?? "";
    if (!inserted && next.length > shown.length && next.startsWith(shown)) {
      inserted = next.slice(shown.length);
    }
    const digits = inserted.replace(/\D/g, "");
    if (digits) {
      for (const digit of digits) typeDigit(part, digit);
      return;
    }
    // A deletion (Backspace without a usable keydown): keep what is left as the pending text.
    setEdit({ part, text: next.replace(/\D/g, "") });
  }

  function segment(part: Part) {
    const n = part === "h" ? h : m;
    return (
      <input
        ref={part === "m" ? minutesRef : undefined}
        id={part === "h" ? field.id : undefined}
        aria-describedby={part === "h" ? field["aria-describedby"] : undefined}
        inputMode="numeric"
        disabled={disabled}
        role="spinbutton"
        aria-label={part === "h" ? t("ui.hours") : t("ui.minutes")}
        aria-valuenow={n}
        aria-valuemin={0}
        aria-valuemax={part === "h" ? 23 : 59}
        value={edit?.part === part ? edit.text : pad(n)}
        // Every tap selects the segment, so typing replaces it (a caret in a full field would block the input).
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.currentTarget.select()}
        onChange={(e) => onInput(part, e)}
        onBlur={() => {
          const pending = editRef.current;
          if (pending?.part === part) {
            commit(part, pending.text);
          }
        }}
        onKeyDown={(e) => onKeyDown(part, e)}
        className="w-[2.4ch] rounded-[4px] bg-transparent py-0.5 text-center font-mono text-lg leading-6 text-foreground tabular-nums outline-none focus:bg-air-soft focus:text-air disabled:cursor-not-allowed"
      />
    );
  }

  return (
    <div
      data-slot="time-field"
      role="group"
      aria-label={ariaLabel ?? t("ui.time")}
      aria-labelledby={field["aria-labelledby"]}
      data-disabled={disabled || undefined}
      className={cn(
        "inline-flex h-11 w-fit items-center justify-self-start rounded-md bg-muted pr-3.5 pl-3",
        "shadow-[inset_0_0_0_1px_var(--border)] transition-[box-shadow,background-color] duration-(--duration-fast)",
        "hover:shadow-[inset_0_0_0_1px_var(--input)] focus-within:bg-card focus-within:shadow-[inset_0_0_0_2px_var(--ring)]",
        field["aria-invalid"] && "shadow-[inset_0_0_0_2px_var(--destructive)]",
        "data-disabled:opacity-55",
        className,
      )}
    >
      <IconClock
        size={16}
        stroke={ICON_STROKE}
        className="mr-2 text-muted-foreground"
        aria-hidden
      />
      {segment("h")}
      <span aria-hidden="true" className="px-px font-mono text-lg leading-6 text-muted-foreground">
        :
      </span>
      {segment("m")}
    </div>
  );
}
