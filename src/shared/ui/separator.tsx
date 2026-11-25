import { Separator as SeparatorPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@luftuj/shared/utils/cn";

type SeparatorProps = ComponentProps<typeof SeparatorPrimitive.Root> & {
  /** Text in the middle of the line ("nebo"). */
  label?: ReactNode;
};

/** A hairline that divides rows inside a plane. Never an outline around a card. */
function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  label,
  ...props
}: SeparatorProps) {
  if (label) {
    return (
      <div
        data-slot="separator"
        role={decorative ? "none" : "separator"}
        className={cn(
          "flex items-center gap-3 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
          className,
        )}
      >
        <span className="legend">{label}</span>
      </div>
    );
  }
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator, type SeparatorProps };
