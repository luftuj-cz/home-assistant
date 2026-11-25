import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE, type IconComponent } from "./icon-types";
import { useFieldControl } from "./field-context";
import { fieldSurface } from "./input";

/** One value from a short list. For a long or searchable list use Combobox. */
function Select(props: ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup(props: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue(props: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

type SelectTriggerProps = ComponentProps<typeof SelectPrimitive.Trigger> & {
  icon?: IconComponent;
  invalid?: boolean;
};

function SelectTrigger({ className, children, icon: Icon, invalid, ...props }: SelectTriggerProps) {
  const field = useFieldControl({ ...props, invalid });
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      {...field}
      className={cn(
        fieldSurface,
        "flex cursor-pointer items-center gap-2.5 text-left",
        "data-[state=open]:bg-card data-[state=open]:shadow-[inset_0_0_0_2px_var(--ring)]",
        "data-placeholder:text-muted-foreground [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate",
        Icon && "pl-3",
        className,
      )}
      {...props}
    >
      {Icon && (
        <Icon
          size={16}
          stroke={ICON_STROKE}
          className="flex-none text-muted-foreground"
          aria-hidden
        />
      )}
      {children}
      <SelectPrimitive.Icon asChild>
        <IconChevronDown
          size={16}
          stroke={ICON_STROKE}
          className="flex-none text-muted-foreground"
          aria-hidden
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** The list sits on a `popover` plane with `shadow-float`, scaling in from the trigger. */
function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        align={align}
        sideOffset={6}
        className={cn(
          "relative z-50 grid max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden",
          "rounded-lg bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-float),0_0_0_1px_var(--border)]",
          "origin-(--radix-select-content-transform-origin) data-[state=open]:animate-menu-in",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="max-h-[264px] overscroll-contain">
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("legend px-2.5 pt-2.5 pb-1", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-sm py-1.5 pr-8 pl-2.5 font-sans text-sm leading-5 outline-none select-none",
        "data-highlighted:bg-accent data-[state=checked]:font-medium",
        "data-disabled:pointer-events-none data-disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2.5 flex items-center text-air">
        <SelectPrimitive.ItemIndicator>
          <IconCheck size={16} stroke={ICON_STROKE} aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1.5 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      <IconChevronUp size={16} stroke={ICON_STROKE} aria-hidden />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-muted-foreground",
        className,
      )}
      {...props}
    >
      <IconChevronDown size={16} stroke={ICON_STROKE} aria-hidden />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
