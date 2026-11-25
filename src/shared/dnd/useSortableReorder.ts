import { useRef, useState } from "react";
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
  // Only the latest reorder's persist may drop the override; an earlier one settling first would flash its order.
  const latest = useRef(0);

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

    reorder(oldIndex, newIndex, onReordered);
  }

  function reorder(
    from: number,
    to: number,
    onReordered: (reordered: T[]) => void | Promise<void>,
  ) {
    const reordered = arrayMove(orderedItems, from, to);
    setOrderOverride(reordered.map(getId));
    latest.current += 1;
    const id = latest.current;

    void Promise.resolve(onReordered(reordered)).finally(() => {
      if (latest.current === id) setOrderOverride(null);
    });
  }

  /** Moves the item at `index` one place up (−1) or down (+1): the grip's ↑ ↓ keys. */
  function moveBy(
    index: number,
    delta: -1 | 1,
    onReordered: (reordered: T[]) => void | Promise<void>,
  ) {
    const to = index + delta;
    if (to < 0 || to >= orderedItems.length) return;
    reorder(index, to, onReordered);
  }

  /** Moves the item at `from` to `to` (indexes in `orderedItems`), e.g. past items the page does not show. */
  function move(from: number, to: number, onReordered: (reordered: T[]) => void | Promise<void>) {
    if (from === to || to < 0 || to >= orderedItems.length) return;
    reorder(from, to, onReordered);
  }

  return { orderedItems, sensors, handleDragEnd, moveBy, move };
}
