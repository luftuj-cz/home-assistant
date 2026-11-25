import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root> & {
  label?: ReactNode;
};

/** Select items in a set. The tick draws itself when checked. */
function Checkbox({ className, label, id, disabled, ...props }: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? autoId;

  const box = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      id={boxId}
      disabled={disabled}
      className={cn(
        "grid size-[22px] flex-none cursor-pointer place-items-center rounded-[7px] border-[1.5px] border-input bg-card text-air-foreground",
        "transition-[background-color,border-color,scale] duration-(--duration-fast) active:not-disabled:scale-[.92]",
        "data-[state=checked]:border-air data-[state=checked]:bg-air",
        "disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-items-center"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 12l5 5L20 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="24"
            className="animate-draw"
          />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label) {
    return box;
  }

  return (
    <div
      data-slot="checkbox-row"
      data-disabled={disabled || undefined}
      className="inline-flex items-center gap-3 data-disabled:opacity-50"
    >
      {box}
      <label htmlFor={boxId} className="body cursor-pointer in-data-disabled:cursor-not-allowed">
        {label}
      </label>
    </div>
  );
}

export { Checkbox, type CheckboxProps };
