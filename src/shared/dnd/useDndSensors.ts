import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";

/**
 * Default dnd-kit sensor set shared across the app: pointer (mouse/touch,
 * unlike native HTML5 drag which doesn't work on touch) with a small
 * activation distance to avoid hijacking clicks, plus keyboard support.
 */
export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
}
