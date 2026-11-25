import type { Announcements, UniqueIdentifier } from "@dnd-kit/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Screen-reader messages for a reorderable list, in the app's language: dnd-kit's own are English and speak of
 * "draggable item 2". Pass `accessibility` to DndContext for pointer drags, call `announceMove` after a ↑ ↓ move,
 * and render `message` in a polite live region.
 */
export function useReorderAnnouncer<T>(
  items: T[],
  getId: (item: T) => UniqueIdentifier,
  getName: (item: T) => string,
) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");

  function nameOf(id: UniqueIdentifier) {
    const item = items.find((candidate) => getId(candidate) === id);
    return item ? getName(item) : "";
  }

  function position(name: string, index: number) {
    return t("ui.reorder.position", { name, position: index + 1, count: items.length });
  }

  function overText(active: UniqueIdentifier, over: UniqueIdentifier | undefined) {
    if (over === undefined) return undefined;
    const index = items.findIndex((item) => getId(item) === over);
    return index < 0 ? undefined : position(nameOf(active), index);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("ui.reorder.pickedUp", { name: nameOf(active.id) }),
    onDragMove: () => undefined,
    onDragOver: ({ active, over }) => overText(active.id, over?.id),
    onDragEnd: ({ active, over }) => overText(active.id, over?.id),
    onDragCancel: () => t("ui.reorder.cancelled"),
  };

  /** After a keyboard move of `item` to `index` (in the new order). */
  function announceMove(item: T, index: number) {
    setMessage(position(getName(item), index));
  }

  return { accessibility: { announcements }, announceMove, message };
}
