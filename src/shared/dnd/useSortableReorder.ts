import { useState } from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

import { useDndSensors } from "./useDndSensors";

/**
 * Drives a dnd-kit sortable list: sensors, an optimistic order override
 * (applied on drop so the item settles into its final spot immediately
 * instead of snapping back until an async persist call resolves), and the
 * drag-end handler that computes the reordered array.
 */
export function useSortableReorder<T, Id extends string | number>(
  items: T[],
  getId: (item: T) => Id,
) {
  const [orderOverride, setOrderOverride] = useState<Id[] | null>(null);

  const orderedItems = (() => {
    if (!orderOverride) return items;
    const byId = new Map(items.map((item) => [getId(item), item]));
    const overridden = orderOverride
      .map((id) => byId.get(id))
      .filter((item): item is T => item !== undefined);
    // If an item was added/removed since the override was captured, fall
    // back to the source order rather than silently dropping/hiding it.
    return overridden.length === items.length ? overridden : items;
  })();

  const sensors = useDndSensors();

  function handleDragEnd(
    event: DragEndEvent,
    onReordered: (reordered: T[]) => void | Promise<void>,
  ) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedItems.findIndex((item) => getId(item) === active.id);
    const newIndex = orderedItems.findIndex((item) => getId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(orderedItems, oldIndex, newIndex);
    setOrderOverride(reordered.map(getId));

    void Promise.resolve(onReordered(reordered)).finally(() => setOrderOverride(null));
  }

  return { orderedItems, sensors, handleDragEnd };
}
