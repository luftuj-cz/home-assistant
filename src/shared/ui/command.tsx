import { IconSearch } from "@tabler/icons-react";
import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE } from "./icon-types";

/** A searchable option list (cmdk). The base of Combobox and MultiSelect. */
function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] font-sans text-sm leading-5 text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Search field on a muted strip at the top of the list. */
function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="mb-1 flex h-[38px] items-center gap-2 rounded-sm bg-muted px-2.5 text-muted-foreground"
    >
      <IconSearch size={16} stroke={ICON_STROKE} className="flex-none" aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/** At most 264px tall; scrolls inside itself, never the page. */
function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[264px] overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:thin]",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("caption px-2.5 py-3.5 text-center text-muted-foreground", className)}
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        // The legend style, spelled out: a custom class does not work inside an arbitrary variant.
        "[&_[cmdk-group-heading]]:block [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1",
        "[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:leading-[14px] [&_[cmdk-group-heading]]:font-medium",
        "[&_[cmdk-group-heading]]:tracking-[.08em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1.5 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex min-h-[38px] cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 outline-none select-none",
        "data-[selected=true]:bg-accent data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-45",
        "[&_svg]:flex-none [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
