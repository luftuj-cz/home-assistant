import type { ComponentType } from "react";

/**
 * An icon passed to a component (`icon={IconWind}`). Tabler icons fit, and so do the custom glyphs. The receiving
 * component sets the size and the 1.5 stroke, so every icon in the system looks the same.
 */
export type IconComponent = ComponentType<{
  size?: number | string;
  stroke?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** Stroke width for every Tabler icon (design system: Iconography). */
export const ICON_STROKE = 1.5;
