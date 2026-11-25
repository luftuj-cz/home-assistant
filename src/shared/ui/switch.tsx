import { Switch as SwitchPrimitive } from "radix-ui";
import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  /** With a label the switch becomes a settings row: text on the left, switch on the right. */
  label?: ReactNode;
  description?: ReactNode;
  /** `sm`: the quiet switch for list rows (air-soft track, air thumb). */
  size?: "default" | "sm";
};

/** On/off that applies immediately. The thumb stretches while held. */
function Switch({
  className,
  label,
  description,
  size = "default",
  id,
  disabled,
  ...props
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const sm = size === "sm";

  const control = (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      id={switchId}
      disabled={disabled}
      className={cn(
        "group/switch relative inline-flex flex-none cursor-pointer items-center rounded-full",
        "transition-[background-color,box-shadow] duration-(--duration-base)",
        "disabled:cursor-not-allowed disabled:opacity-45",
        sm
          ? "h-[22px] w-9 bg-secondary data-[state=checked]:bg-air-soft data-[state=checked]:shadow-[inset_0_0_0_1px_var(--air)]"
          : "h-7 w-[46px] bg-secondary shadow-[inset_0_0_0_1px_var(--input)] data-[state=checked]:bg-air data-[state=checked]:shadow-none",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none absolute top-[3px] left-[3px] block rounded-full bg-card",
          "transition-[translate,width] duration-(--duration-base) ease-(--ease-spring)",
          sm
            ? [
                "size-4 shadow-[0_0_0_1px_var(--input)]",
                "data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-air data-[state=checked]:shadow-none",
                "group-active/switch:group-enabled/switch:w-[19px] group-active/switch:group-enabled/switch:data-[state=checked]:translate-x-[11px]",
              ]
            : [
                "size-[22px] shadow-[0_1px_3px_rgba(0,0,0,.25)]",
                "data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-air-foreground",
                "group-active/switch:group-enabled/switch:w-[26px] group-active/switch:group-enabled/switch:data-[state=checked]:translate-x-3.5",
              ],
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label) {
    return control;
  }

  return (
    <div
      data-slot="switch-row"
      data-disabled={disabled || undefined}
      className="flex items-center justify-between gap-4 data-disabled:opacity-50"
    >
      <label
        htmlFor={switchId}
        className="grid cursor-pointer gap-0.5 in-data-disabled:cursor-not-allowed"
      >
        <span data-slot="switch-label" className="label">
          {label}
        </span>
        {description && <span className="caption text-muted-foreground">{description}</span>}
      </label>
      {control}
    </div>
  );
}

export { Switch, type SwitchProps };
