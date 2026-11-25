import { IconCheck, IconDots } from "@tabler/icons-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@luftuj/shared/utils/cn";

import { Button } from "./button";
import { ICON_STROKE, type IconComponent } from "./icon-types";

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuGroup(props: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

/** Scales in from the trigger's corner. */
function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = "end",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          "z-50 grid min-w-40 rounded-md bg-popover p-1 font-sans text-sm leading-5 text-popover-foreground shadow-float outline-none",
          "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
          "origin-(--radix-dropdown-menu-content-transform-origin) data-[state=open]:animate-menu-in",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

const itemClass = [
  "relative flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-left outline-none select-none",
  "data-highlighted:bg-accent data-disabled:pointer-events-none data-disabled:opacity-45",
  "[&_svg]:shrink-0 [&_svg]:text-muted-foreground",
].join(" ");

type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  icon?: IconComponent;
  /** Last in the menu, in `destructive`. If it needs confirming, open a Dialog from it. */
  destructive?: boolean;
};

function DropdownMenuItem({
  className,
  icon: Icon,
  destructive,
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={destructive ? "destructive" : undefined}
      className={cn(
        itemClass,
        destructive &&
          "text-destructive data-highlighted:bg-destructive-soft data-highlighted:text-destructive [&_svg]:text-destructive",
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={16} stroke={ICON_STROKE} aria-hidden />}
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClass, "pr-8", className)}
      {...props}
    >
      {children}
      <span className="absolute right-2.5 flex items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <IconCheck size={16} stroke={ICON_STROKE} className="text-air!" aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn("legend px-2.5 pt-2 pb-1", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

interface MenuItem {
  label: string;
  icon?: IconComponent;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

interface MenuProps {
  items: MenuItem[];
  /** The trigger's accessible name; name the object ("Akce události 06:00"). */
  label?: string;
  align?: "start" | "end";
  /** The trigger icon; three dots by default. */
  icon?: IconComponent;
  disabled?: boolean;
}

/**
 * A small action menu for rows too narrow for a set of icon buttons (TimelineDay events, damper group headers on a
 * phone). Not for a row's main action: keep that visible.
 */
function Menu({ items, label, align = "end", icon = IconDots, disabled }: Readonly<MenuProps>) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="icon-sm"
          icon={icon}
          aria-label={label ?? t("ui.moreActions")}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            icon={item.icon}
            destructive={item.destructive}
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Menu,
  type MenuItem,
  type MenuProps,
};
