import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

type RadioGroupProps = Omit<ComponentProps<typeof RadioGroupPrimitive.Root>, "children"> & {
  items: RadioOption[];
  /** The radio dot; without it the card's own highlight shows the choice (tiles). Default true. */
  indicator?: boolean;
};

/**
 * One of a few options that need explaining, as option cards. The selected card is `air-soft` with an `air`
 * ring. For short options applied immediately use ToggleGroup. With `indicator={false}` the dot goes and the radio
 * covers the whole card, so the card is what takes focus and shows the ring.
 */
function RadioGroup({ className, items, indicator = true, ...props }: RadioGroupProps) {
  const baseId = useId();
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2", className)}
      {...props}
    >
      {items.map((item) => {
        const id = `${baseId}-${item.value}`;
        return (
          <label
            key={item.value}
            htmlFor={id}
            className={cn(
              "relative flex cursor-pointer gap-3 rounded-lg bg-muted px-4",
              // Tiles (no dot) centre their content across, from the top so icons line up side by side; option cards keep
              // the dot and text on the left.
              indicator ? "items-start py-3.5" : "items-start justify-center py-5 text-center",
              "shadow-[inset_0_0_0_1px_transparent] transition-[box-shadow,background-color] duration-(--duration-fast)",
              "has-data-[state=checked]:bg-air-soft has-data-[state=checked]:shadow-[inset_0_0_0_1.5px_var(--air)]",
              "has-disabled:cursor-not-allowed has-disabled:opacity-50",
            )}
          >
            <RadioGroupPrimitive.Item
              data-slot="radio-group-item"
              id={id}
              value={item.value}
              disabled={item.disabled}
              className={cn(
                indicator
                  ? [
                      "mt-px grid size-[22px] flex-none cursor-pointer place-items-center rounded-full border-[1.5px] border-input bg-card",
                      "transition-[border-color,scale] duration-(--duration-fast) active:not-disabled:scale-[.92]",
                      "data-[state=checked]:border-air disabled:cursor-not-allowed",
                    ]
                  : [
                      "absolute inset-0 cursor-pointer rounded-[inherit] border-0 bg-transparent",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed",
                    ],
              )}
            >
              {indicator && (
                <RadioGroupPrimitive.Indicator className="block size-2.5 animate-radio-in rounded-full bg-air" />
              )}
            </RadioGroupPrimitive.Item>
            <span className={cn("grid gap-0.5", !indicator && "justify-items-center")}>
              <span className="label">{item.label}</span>
              {item.description && (
                <span className="caption text-muted-foreground">{item.description}</span>
              )}
            </span>
          </label>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

export { RadioGroup, type RadioGroupProps, type RadioOption };
