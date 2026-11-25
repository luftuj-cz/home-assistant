import { IconGripVertical } from "@tabler/icons-react";
import type { KeyboardEvent } from "react";

import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { cn } from "@luftuj/shared/utils/cn";

interface SortableGripProps {
  /** `dragHandleProps` from SortableItem: the pointer drag. */
  handle: Record<string, unknown>;
  /** ↑ moves the item up (−1), ↓ down (+1). */
  onMove: (delta: -1 | 1) => void;
  label: string;
  size?: number;
  className?: string;
}

/**
 * The grip that reorders an item: drag it with a pointer, or focus it and press ↑ ↓. The keys move the item one
 * place at once, so dnd-kit's pick-up-with-Space flow (and its instructions) are left out.
 */
export function SortableGrip({
  handle,
  onMove,
  label,
  size = 16,
  className,
}: Readonly<SortableGripProps>) {
  const {
    onKeyDown: _dndKeyDown,
    "aria-describedby": _dndInstructions,
    "aria-roledescription": _dndRole,
    role: _role,
    tabIndex: _tabIndex,
    ...pointer
  } = handle;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onMove(event.key === "ArrowUp" ? -1 : 1);
    }
  }

  return (
    <button
      type="button"
      data-slot="sortable-grip"
      aria-label={label}
      title={label}
      onKeyDown={onKeyDown}
      {...pointer}
      className={cn(
        "grid flex-none cursor-grab touch-none place-items-center rounded-sm border-0 bg-transparent p-0 text-muted-foreground",
        "hover:bg-accent hover:text-foreground active:cursor-grabbing",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <IconGripVertical size={size} stroke={ICON_STROKE} aria-hidden />
    </button>
  );
}
