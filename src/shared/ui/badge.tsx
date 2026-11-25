import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { Dot, type Tone } from "./dot";
import { ICON_STROKE, type IconComponent } from "./icon-types";

const badgeVariants = cva(
  [
    "inline-flex h-6 w-fit shrink-0 items-center gap-1.5 rounded-sm px-[9px]",
    "font-sans text-xs leading-4 font-medium whitespace-nowrap",
    "[&>svg]:pointer-events-none [&>svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "text-foreground shadow-[inset_0_0_0_1px_var(--input)]",
        air: "bg-air-soft text-air",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        destructive: "bg-destructive-soft text-destructive",
        // MANUÁLNÍ: the running manual mode, set in mono capitals.
        manual: "bg-manual-soft font-mono text-[11px] tracking-[.06em] text-manual uppercase",
        plan: "bg-plan-soft text-plan",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const DOT_TONE: Record<BadgeVariant, Tone> = {
  default: "neutral",
  secondary: "neutral",
  outline: "neutral",
  air: "air",
  success: "success",
  warning: "warning",
  destructive: "destructive",
  manual: "manual",
  plan: "plan",
};

type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    icon?: IconComponent;
    /** A dot in the badge's colour before the text. */
    dot?: boolean;
  };

/** Short label: version, count, category. For a state (connected, failing) use StatusBadge. */
function Badge({
  className,
  variant = "secondary",
  asChild = false,
  icon: Icon,
  dot,
  children,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";
  const tone = DOT_TONE[variant ?? "secondary"];

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot && <Dot tone={tone} />}
      {Icon && <Icon size={14} stroke={ICON_STROKE} aria-hidden />}
      {children}
    </Comp>
  );
}

export { Badge, badgeVariants, type BadgeProps };
