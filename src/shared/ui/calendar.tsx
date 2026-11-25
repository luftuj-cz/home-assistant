import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
} from "@tabler/icons-react";
import { useEffect, useRef, type ComponentProps } from "react";
import { DayPicker, type DayButton } from "react-day-picker";
import { cs, enUS } from "react-day-picker/locale";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { buttonVariants } from "./button";
import { ICON_STROKE } from "./icon-types";

const CHEVRON = {
  left: IconChevronLeft,
  right: IconChevronRight,
  up: IconChevronUp,
  down: IconChevronDown,
};

/**
 * A month grid, Monday first, in the app's language. Today has an `air` ring, the selected day is filled `air`,
 * weekends are muted, days outside the allowed range are disabled. Used inside DateTimeField.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = false,
  components,
  ...props
}: ComponentProps<typeof DayPicker>) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("cs") ? cs : enUS;

  return (
    <DayPicker
      locale={locale}
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      labels={{
        labelPrevious: () => t("ui.previousMonth"),
        labelNext: () => t("ui.nextMonth"),
      }}
      modifiers={{ weekend: { dayOfWeek: [0, 6] } }}
      className={cn("w-[280px] max-w-full font-sans", className)}
      classNames={{
        months: "relative grid gap-2",
        month: "grid gap-2",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "aria-disabled:opacity-30",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "aria-disabled:opacity-30",
        ),
        month_caption: "flex h-8 items-center justify-center",
        caption_label: "label capitalize",
        month_grid: "w-full border-collapse",
        weekdays: "grid grid-cols-7",
        weekday: "legend py-1 text-center",
        week: "grid grid-cols-7 gap-0.5 mt-0.5",
        day: "p-0 text-center",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) => {
          const Icon = CHEVRON[orientation ?? "down"];
          return <Icon size={16} stroke={ICON_STROKE} className={chevronClass} aria-hidden />;
        },
        DayButton: CalendarDayButton,
        ...components,
      }}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: ComponentProps<typeof DayButton>) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.isoDate}
      className={cn(
        "grid aspect-square w-full cursor-pointer place-items-center rounded-sm font-sans text-sm leading-none tabular-nums",
        "transition-colors duration-(--duration-fast) hover:not-disabled:bg-accent",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-30",
        modifiers.weekend && "text-muted-foreground",
        modifiers.outside && "text-muted-foreground opacity-50",
        modifiers.today && "font-semibold shadow-[inset_0_0_0_1.5px_var(--air)]",
        modifiers.selected &&
          "bg-air font-semibold text-air-foreground shadow-none hover:not-disabled:bg-air",
        className,
      )}
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
