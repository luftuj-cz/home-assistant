import { useRef } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import type { DamperState } from "./damper-geometry";
import { useServo } from "./use-servo";

const DEG = Math.PI / 180;

/** Looking along the duct the blade's width is sin α: a thin line when open, the full disc when closed. */
function bladeRx(angle: number) {
  return Math.max(1.6, 17 * Math.sin(angle * DEG)).toFixed(2);
}

interface DamperDialProps {
  /** 0 = open … 90 = closed. */
  angle: number;
  state?: DamperState;
  /** 24–48px. */
  size?: number;
  className?: string;
}

/**
 * The same damper module seen from the front, for small sizes (lists, "Nastavit vše", the mode editor): the ring,
 * the blade as an ellipse, the servo on top. It moves like DamperModule. Decorative: put the value next to it.
 */
export function DamperDial({
  angle,
  state = "open",
  size = 48,
  className,
}: Readonly<DamperDialProps>) {
  const blade = useRef<SVGEllipseElement>(null);
  const { start } = useServo(Math.max(0, Math.min(90, angle)), (value) =>
    blade.current?.setAttribute("rx", bladeRx(value)),
  );
  return (
    <span
      data-slot="damper-dial"
      data-state={state}
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        "inline-grid flex-none data-[state=offline]:opacity-55 data-[state=offline]:grayscale",
        className,
      )}
    >
      <svg viewBox="0 0 48 48" className="size-full">
        <rect
          x="17"
          y="1"
          width="14"
          height="7"
          rx="1.5"
          className="fill-(--damper-servo) stroke-(--damper-servo-ink) [stroke-width:.8]"
        />
        <rect x="15" y="6.5" width="18" height="3" rx="1" className="fill-(--damper-body)" />
        <circle cx="24" cy="28" r="19.5" className="fill-(--damper-rim)" />
        <circle
          cx="24"
          cy="28"
          r="18.2"
          className="fill-none stroke-(--damper-body) [stroke-width:1]"
        />
        <circle
          cx="24"
          cy="28"
          r="17"
          className="fill-(--dm-ground,var(--card)) stroke-(--damper-inner) [stroke-width:1.5]"
        />
        <ellipse
          ref={blade}
          cx="24"
          cy="28"
          rx={bladeRx(start)}
          ry="16.4"
          className="fill-(--damper-blade) stroke-(--damper-blade-edge) [stroke-width:1]"
        />
        <line
          x1="24"
          y1="11"
          x2="24"
          y2="45"
          className="stroke-(--damper-blade-edge) [stroke-width:1.2] [stroke-linecap:round]"
        />
      </svg>
    </span>
  );
}
