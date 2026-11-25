import { useEffect, useId, useState, type CSSProperties } from "react";

import { AnimatedNumber } from "@luftuj/shared/ui/animated-number";
import { Legend } from "@luftuj/shared/ui/legend";

interface PowerGaugeProps {
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  legend: string;
  /** The configured limit: an ink tick on the arc. */
  configuredMax?: number;
  /** Width in px. */
  size?: number;
}

const R = 80;
const CENTER = 100;
const START = 135;
const SWEEP = 270;

function point(deg: number, radius = R): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CENTER + radius * Math.cos(a), CENTER + radius * Math.sin(a)];
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The unit's power as an instrument arc in `air` (no thresholds: the configured limit is the meaningful mark). The
 * arc sweeps to its value over 900ms and the number counts with it; small dots travel along the filled part, faster
 * at higher power, and stop under reduced motion.
 */
export function PowerGauge({
  value,
  min = 0,
  max = 100,
  unit = "%",
  legend,
  configuredMax,
  size = 208,
}: Readonly<PowerGaugeProps>) {
  const maskId = useId();
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  // Start empty and sweep in on mount.
  const [shown, setShown] = useState(prefersReducedMotion);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const [x1, y1] = point(START);
  const [x2, y2] = point(START + SWEEP);
  const arc = `M${x1} ${y1}A${R} ${R} 0 1 1 ${x2} ${y2}`;
  const dash = `${(shown ? ratio : 0) * 100} 100`;
  const capDeg =
    configuredMax == null
      ? null
      : START + SWEEP * Math.max(0, Math.min(1, (configuredMax - min) / (max - min || 1)));

  return (
    <div data-slot="power-gauge" className="relative mx-auto" style={{ width: size }}>
      <svg
        viewBox="-10 -10 220 205"
        role="img"
        aria-label={`${legend}: ${value} ${unit}`}
        className="block w-full overflow-visible"
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="-10" y="-10" width="220" height="205">
            <path
              d={arc}
              pathLength={100}
              strokeDasharray={dash}
              className="fill-none stroke-white [stroke-linecap:round] [stroke-width:12] transition-[stroke-dasharray] duration-900 ease-(--ease-out)"
            />
          </mask>
        </defs>
        <g>
          {Array.from({ length: 11 }, (_, i) => {
            const deg = START + (SWEEP * i) / 10;
            const major = i % 5 === 0;
            const [a, b] = point(deg, R + 9);
            const [c, d] = point(deg, R + (major ? 17 : 14));
            return (
              <line
                key={deg}
                x1={a}
                y1={b}
                x2={c}
                y2={d}
                className={
                  major
                    ? "stroke-muted-foreground [stroke-width:1.75]"
                    : "stroke-input [stroke-width:1.25]"
                }
                strokeLinecap="round"
              />
            );
          })}
        </g>
        <path
          d={arc}
          className="fill-none stroke-secondary [stroke-linecap:round] [stroke-width:12]"
        />
        <path
          d={arc}
          pathLength={100}
          strokeDasharray={dash}
          style={{ opacity: ratio > 0 ? 1 : 0 }}
          className="fill-none stroke-air [stroke-linecap:round] [stroke-width:12] transition-[stroke-dasharray,opacity] duration-900 ease-(--ease-out)"
        />
        {ratio > 0 && (
          <path
            d={arc}
            mask={`url(#${maskId})`}
            style={{ "--flow": `${(2.4 - 1.6 * ratio).toFixed(2)}s` } as CSSProperties}
            className="animate-flow fill-none stroke-air-foreground [stroke-dasharray:0.1_17.9] [stroke-linecap:round] [stroke-opacity:.55] [stroke-width:3.2] motion-reduce:animate-none"
          />
        )}
        {capDeg !== null &&
          (() => {
            const [a, b] = point(capDeg, R - 12);
            const [c, d] = point(capDeg, R + 12);
            return (
              <line
                x1={a}
                y1={b}
                x2={c}
                y2={d}
                className="stroke-foreground [stroke-width:2.5]"
                strokeLinecap="round"
              />
            );
          })()}
      </svg>
      <div className="absolute top-[53.6%] left-1/2 grid -translate-x-1/2 -translate-y-1/2 justify-items-center text-center">
        <Legend className="mb-0.5">{legend}</Legend>
        <AnimatedNumber value={value} className="readout-xl" />
        <span className="code text-muted-foreground">{unit}</span>
      </div>
      <div className="code absolute inset-x-[22%] bottom-[2%] flex justify-between text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
