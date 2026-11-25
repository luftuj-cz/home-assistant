import { IconCalendarEvent, IconChevronDown } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";
import { Calendar } from "./calendar";
import { useFieldControl, type FieldControlProps } from "./field-context";
import { ICON_STROKE } from "./icon-types";
import { fieldSurface } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { TimeField } from "./time-field";

interface Preset {
  label: ReactNode;
  /** "YYYY-MM-DDTHH:MM". */
  value: string;
}

interface DateTimeFieldProps extends FieldControlProps {
  /** "YYYY-MM-DDTHH:MM", local time. The API's "YYYY-MM-DD HH:mm:ss" is converted by the caller. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Same format; earlier days are disabled. */
  min?: string;
  /** "YYYY-MM-DD"; today's ring in the calendar. Defaults to the real today. */
  today?: string;
  /** Quick picks above the calendar ("Dnes 22:00", "Zítra 18:00", "Za 3 dny", "Za týden"). */
  presets?: Preset[];
  placeholder?: ReactNode;
  /** A short relative note shown in the field ("za 3 d"), computed by the caller. */
  hint?: ReactNode;
  defaultOpen?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A date and a time in one field ("24. 11. 2026 · 18:00"). The popover holds optional presets, a Calendar and a
 * TimeField; "Hotovo" closes it. It opens above the field when the room below is short.
 */
export function DateTimeField({
  value,
  defaultValue = "",
  onValueChange,
  min,
  today,
  presets = [],
  placeholder,
  hint,
  defaultOpen = false,
  invalid,
  disabled,
  className,
  ...props
}: Readonly<DateTimeFieldProps>) {
  const { t, i18n } = useTranslation();
  const field = useFieldControl({ ...props, invalid });
  const [inner, setInner] = useState(defaultValue);
  const [open, setOpen] = useState(defaultOpen);
  const current = value ?? inner;
  const [date, time = "18:00"] = (current || "T18:00").split("T");

  function set(next: string) {
    setInner(next);
    onValueChange?.(next);
  }

  const dateLabel = date
    ? new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "numeric",
        year: "numeric",
      }).format(parseYmd(date))
    : "";
  const minDay = min?.split("T")[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="date-time-field"
          disabled={disabled}
          {...field}
          className={cn(
            fieldSurface,
            "flex cursor-pointer items-center gap-2.5 pl-3 text-left data-[state=open]:bg-card data-[state=open]:shadow-[inset_0_0_0_2px_var(--ring)]",
            className,
          )}
        >
          <IconCalendarEvent
            size={16}
            stroke={ICON_STROKE}
            className="flex-none text-muted-foreground"
            aria-hidden
          />
          {current ? (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">
                {dateLabel} · {time}
              </span>
              {hint && (
                <span className="caption max-w-[45%] flex-none truncate text-muted-foreground">
                  {hint}
                </span>
              )}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {placeholder ?? t("ui.pickDateTime")}
            </span>
          )}
          <IconChevronDown
            size={16}
            stroke={ICON_STROKE}
            className="flex-none text-muted-foreground"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={t("ui.dateTime")}
        // As wide as the field (presets wrap, the calendar fills it); at least 280px so a narrow field still fits the
        // calendar, never wider than the screen.
        className="w-(--radix-popover-trigger-width) min-w-[280px] max-w-[calc(100vw-32px)] gap-3 p-3.5"
      >
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                aria-pressed={current === preset.value}
                onClick={() => set(preset.value)}
                className={cn(
                  "inline-flex h-[30px] cursor-pointer items-center rounded-full bg-secondary px-3 font-sans text-xs leading-4 font-medium text-secondary-foreground",
                  "transition-[background-color,box-shadow,scale] duration-(--duration-fast) active:scale-[.97]",
                  "hover:shadow-[inset_0_0_0_1.5px_var(--air)]",
                  current === preset.value && "bg-air text-air-foreground",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
        <Calendar
          mode="single"
          required={false}
          className="w-full"
          selected={date ? parseYmd(date) : undefined}
          defaultMonth={parseYmd(date || today || toYmd(new Date()))}
          today={today ? parseYmd(today) : undefined}
          disabled={minDay ? { before: parseYmd(minDay) } : undefined}
          onSelect={(day) => day && set(`${toYmd(day)}T${time}`)}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="label">{t("ui.time")}</span>
          <TimeField
            value={time}
            step={15}
            onValueChange={(next) => set(`${date || toYmd(new Date())}T${next}`)}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(false)}>
            {t("ui.done")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
