import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE, type IconComponent } from "./icon-types";
import { Spinner } from "./spinner";

// Hover fills only where a real hover exists (Tailwind's `hover:` is already inside `@media (hover: hover)`).
// Pressing scales with a mouse; on touch the button darkens instead, because a shrinking button reads as a jump.
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent",
    "font-sans text-sm leading-5 font-medium whitespace-nowrap",
    "transition-[background-color,color,border-color,scale,filter] duration-(--duration-fast)",
    "pointer-fine:active:not-disabled:scale-[.98] pointer-coarse:active:not-disabled:brightness-90",
    "disabled:cursor-not-allowed disabled:opacity-45",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:not-disabled:bg-[color-mix(in_oklab,var(--primary)_86%,var(--background))]",
        secondary:
          "bg-secondary text-secondary-foreground hover:not-disabled:bg-[color-mix(in_oklab,var(--secondary)_88%,var(--foreground))]",
        outline:
          "border-input bg-transparent text-foreground hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground",
        ghost:
          "bg-transparent text-foreground hover:not-disabled:bg-accent hover:not-disabled:text-accent-foreground",
        air: "bg-air text-air-foreground hover:not-disabled:bg-[color-mix(in_oklab,var(--air)_88%,var(--foreground))]",
        destructive:
          "bg-destructive text-destructive-foreground hover:not-disabled:bg-[color-mix(in_oklab,var(--destructive)_88%,var(--foreground))]",
        manual:
          "bg-manual text-manual-foreground hover:not-disabled:bg-[color-mix(in_oklab,var(--manual)_88%,var(--foreground))]",
        plan: "bg-plan text-plan-foreground hover:not-disabled:bg-[color-mix(in_oklab,var(--plan)_88%,var(--foreground))]",
        /** A quiet destructive action next to the main one (e.g. "Smazat" in a dialog footer). */
        "danger-ghost":
          "bg-transparent text-destructive hover:not-disabled:bg-destructive-soft hover:not-disabled:text-destructive",
        link: [
          "h-auto rounded-[4px] border-0 bg-transparent p-0 text-air underline decoration-1 underline-offset-3",
          "transition-[color,text-decoration-thickness] active:not-disabled:scale-100",
          "hover:not-disabled:text-[color-mix(in_oklab,var(--air)_80%,var(--foreground))] hover:not-disabled:decoration-2",
        ],
      },
      size: {
        default: "h-10 px-[18px]",
        sm: "h-[34px] px-3.5 text-[13px]",
        lg: "h-12 px-6 text-[15px]",
        icon: "size-10 p-0",
        "icon-sm": "size-8 rounded-sm p-0 text-muted-foreground",
      },
    },
    compoundVariants: [
      { variant: "link", size: ["default", "sm", "lg"], className: "h-auto px-0" },
      { variant: "secondary", size: "icon-sm", className: "text-secondary-foreground" },
    ],
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a link) with the button's look. */
    asChild?: boolean;
    icon?: IconComponent;
    iconRight?: IconComponent;
    /** Shows a spinner in place of the icon and disables the button. */
    loading?: boolean;
  };

/** Triggers an action. One ink `default` per region; the rest secondary or ghost. */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const iconSize = size === "lg" ? 20 : 18;

  if (asChild) {
    return (
      <Slot.Root
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? (
        <Spinner size={16} className="text-current" />
      ) : (
        Icon && <Icon size={iconSize} stroke={ICON_STROKE} aria-hidden />
      )}
      {children}
      {IconRight && <IconRight size={16} stroke={ICON_STROKE} aria-hidden />}
    </button>
  );
}

export { Button, buttonVariants, type ButtonProps };
