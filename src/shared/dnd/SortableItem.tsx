import type { CSSProperties, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export interface SortableItemRenderProps {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  dragHandleProps: Record<string, unknown>;
}

export interface SortableItemProps {
  id: string | number;
  children: (props: SortableItemRenderProps) => ReactNode;
}

/**
 * Thin wrapper around dnd-kit's `useSortable` exposed as a render prop, so
 * consumers can attach the drag handle to any element in their own markup
 * (e.g. a grip icon) instead of the whole row.
 */
export function SortableItem({ id, children }: Readonly<SortableItemProps>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return children({
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    },
    isDragging,
    dragHandleProps: { ...attributes, ...listeners },
  });
}
