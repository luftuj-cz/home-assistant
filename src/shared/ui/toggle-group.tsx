import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { Dot } from "./dot";
import { ICON_STROKE, type IconComponent } from "./icon-types";
import { indicatorClass, useIndicator } from "./use-indicator";

interface ToggleGroupItem {
  value: string;
  label: ReactNode;
  icon?: IconComponent;
  /** A colour dot before the label (a mode's colour). */
  dot?: string;
  /** Anything after the label, e.g. a count. */
  extra?: ReactNode;
  disabled?: boolean;
}

interface ToggleGroupProps {
  items: ToggleGroupItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  size?: "default" | "sm";
  /** Stretch to the container's width with equal segments; otherwise as wide as the content. */
  full?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * Segmented single choice, applied immediately (replaces SegmentedControl). 2–4 short options. The selected
 * segment is a card-coloured thumb that slides between segments. One option is always selected.
 */
function ToggleGroup({
  items,
  value,
  defaultValue,
  onValueChange,
  size = "default",
  full,
  disabled,
  "aria-label": ariaLabel,
  className,
}: Readonly<ToggleGroupProps>) {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.value ?? "");
  const current = value ?? inner;
  const ref = useRef<HTMLDivElement>(null);
  useIndicator(ref, '[data-state="on"]', current);

  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      data-slot="toggle-group"
      type="single"
      value={current}
      disabled={disabled}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        // Radix clears the value when the active item is clicked again; a segmented control keeps it.
        if (!next) {
          return;
        }
        setInner(next);
        onValueChange?.(next);
      }}
      className={cn(
        "relative max-w-full gap-1 overflow-x-auto rounded-md bg-muted p-1",
        full ? "flex w-full" : "inline-flex",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          indicatorClass,
          "rounded-[calc(var(--radius-md)-4px)] bg-card shadow-[var(--shadow-plane),0_1px_2px_rgba(0,0,0,.08)]",
        )}
      />
      {items.map(({ value: itemValue, label, icon: Icon, dot, extra, disabled: itemDisabled }) => (
        <ToggleGroupPrimitive.Item
          key={itemValue}
          value={itemValue}
          disabled={itemDisabled}
          data-slot="toggle-group-item"
          className={cn(
            "z-1 inline-flex cursor-pointer items-center justify-center gap-2 rounded-[calc(var(--radius-md)-4px)]",
            "font-sans font-medium whitespace-nowrap text-muted-foreground",
            "transition-colors duration-(--duration-base) hover:text-foreground data-[state=on]:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            "disabled:cursor-not-allowed disabled:opacity-45",
            size === "sm"
              ? "h-7 px-2.5 text-[13px] leading-5"
              : "h-[34px] px-3.5 text-sm leading-5",
            full && "flex-1",
          )}
        >
          {dot && <Dot color={dot} />}
          {Icon && <Icon size={16} stroke={ICON_STROKE} aria-hidden />}
          <span>{label}</span>
          {extra}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

export { ToggleGroup, type ToggleGroupItem, type ToggleGroupProps };
