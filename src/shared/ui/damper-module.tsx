import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { cn } from "@luftuj/shared/utils/cn";

import {
  bladeGeometry,
  DAMPER_STATIC,
  G,
  proj,
  type BladeGeometry,
  type DamperState,
} from "./damper-geometry";
import { useServo } from "./use-servo";

const STREAKS = 12;
const AIR_TAIL_MS = 2400;
const SVG_NS = "http://www.w3.org/2000/svg";

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

interface Streak {
  x: number;
  y: number;
  z: number;
  inner: SVGLineElement;
  outer: SVGLineElement;
  index: number;
}

function randomSpot() {
  const r = 0.72 * Math.sqrt(Math.random());
  const t = Math.random() * 2 * Math.PI;
  return { x: r * Math.cos(t), y: r * Math.sin(t) * 0.9 };
}

/**
 * Air streaks passing through the duct towards the viewer; how many and how fast follow the open area. Inside the
 * duct they draw in `inner` (clipped by the bore), past the front plane in `outer`. Paused off screen.
 */
function useAirflow(
  innerRef: RefObject<SVGGElement | null>,
  outerRef: RefObject<SVGGElement | null>,
  openness: RefObject<number>,
  running: boolean,
) {
  useEffect(() => {
    const inner = innerRef.current;
    const outer = outerRef.current;
    if (!inner || !outer || !running || prefersReducedMotion()) return;
    const streaks: Streak[] = Array.from({ length: STREAKS }, (_, index) => {
      const a = document.createElementNS(SVG_NS, "line");
      const b = document.createElementNS(SVG_NS, "line");
      inner.appendChild(a);
      outer.appendChild(b);
      return { ...randomSpot(), z: G.ZB + (index / STREAKS) * 1.6, inner: a, outer: b, index };
    });
    let raf = 0;
    let last = performance.now();
    let visible = true;

    function place(line: SVGLineElement, from: number[], to: number[], opacity: number) {
      line.setAttribute("x1", from[0].toFixed(1));
      line.setAttribute("y1", from[1].toFixed(1));
      line.setAttribute("x2", to[0].toFixed(1));
      line.setAttribute("y2", to[1].toFixed(1));
      line.setAttribute("opacity", opacity.toFixed(2));
    }

    function step(now: number) {
      if (!visible) {
        raf = 0;
        return;
      }
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const open = openness.current;
      const active = Math.round(STREAKS * open);
      for (const s of streaks) {
        s.z += (0.8 + 1.8 * open) * dt;
        if (s.z > 1.25) {
          Object.assign(s, randomSpot());
          s.z = G.ZB - 0.1;
        }
        const fade = Math.max(0, Math.min(1, (s.z - G.ZB) / 0.3, (1.25 - s.z) / 0.45));
        const length = 0.1 + 0.16 * open;
        const from = proj([s.x, s.y, s.z]);
        const to = proj([s.x, s.y, s.z + length]);
        const insideDuct = s.z + length <= G.ZF + 0.05;
        const opacity = s.index < active ? 0.85 * fade : 0;
        place(s.inner, from, to, insideDuct ? opacity : 0);
        place(s.outer, from, to, insideDuct ? 0 : opacity);
      }
      raf = requestAnimationFrame(step);
    }

    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && !raf) {
              last = performance.now();
              raf = requestAnimationFrame(step);
            }
          });
    observer?.observe(inner.ownerSVGElement ?? inner);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      inner.replaceChildren();
      outer.replaceChildren();
    };
  }, [innerRef, outerRef, openness, running]);
}

const BLADE_PARTS = ["back", "mid", "front"] as const;
const EDGE_PARTS = ["edgeBack", "edgeMid", "edgeFront"] as const;

const BLADE = "fill-(--damper-blade)";
const EDGE =
  "fill-none stroke-(--damper-blade-edge) [stroke-width:1.4] [stroke-linecap:round] [stroke-linejoin:round] group-data-[state=offline]/dm:[stroke-dasharray:3_3]";
const AIR =
  "[&>line]:stroke-[color-mix(in_oklab,var(--air)_72%,#fff)] [&>line]:[stroke-width:2.2] [&>line]:[stroke-linecap:round]";

interface DamperModuleProps {
  /** 0 = open (blade along the airflow) … 90 = closed (blade across the duct). */
  angle: number;
  state?: DamperState;
  /** Width in px; the height follows. */
  size?: number;
  /** `auto`: while moving, 2.4 s after, and on hover. `always` for hero use, `off` for static grids. */
  airflow?: "auto" | "always" | "off";
  /** The luftuj.cz engraving on the servo; on by default from 140px. */
  engraving?: boolean;
  /** When set the drawing is an image with this label; otherwise decorative. */
  label?: string;
  className?: string;
}

/**
 * The LUFTaTOR damper module LT-DM-A in 3/4 view: a round duct with seal ribs, a butterfly blade on a vertical axle
 * that turns like the servo, the turquoise servo housing on top, and air passing through while it moves. Set
 * `--dm-ground` on a parent to the surface behind it (default `card`).
 */
export function DamperModule({
  angle,
  state,
  size = 120,
  airflow = "auto",
  engraving,
  label,
  className,
}: Readonly<DamperModuleProps>) {
  // useId's characters are not all valid inside url(#…).
  const id = `dm${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const target = Math.max(0, Math.min(90, angle));
  const offline = state === "offline";
  const paths = useRef<Partial<Record<keyof BladeGeometry, SVGPathElement | null>>>({});
  const openness = useRef(1);

  function paint(value: number) {
    const geometry = bladeGeometry(value);
    openness.current = offline ? 0 : geometry.openness;
    for (const key of [...BLADE_PARTS, ...EDGE_PARTS]) {
      paths.current[key]?.setAttribute("d", geometry[key]);
    }
    for (const key of BLADE_PARTS) paths.current[key]?.style.setProperty("fill", geometry.fill);
  }

  const { start, moving } = useServo(target, paint);
  const [initial] = useState(() => bladeGeometry(start));
  useEffect(() => {
    openness.current = offline ? 0 : bladeGeometry(target).openness;
    // paint() refines this frame by frame while the blade moves.
  }, [offline, target]);

  const [hover, setHover] = useState(false);
  const [tail, setTail] = useState(false);
  useEffect(() => {
    if (moving) {
      setTail(true);
      return;
    }
    const timer = setTimeout(() => setTail(false), AIR_TAIL_MS);
    return () => clearTimeout(timer);
  }, [moving]);

  const running =
    !offline &&
    target < 89 &&
    (airflow === "always" || (airflow === "auto" && (hover || moving || tail)));
  const inner = useRef<SVGGElement>(null);
  const outer = useRef<SVGGElement>(null);
  useAirflow(inner, outer, openness, running);

  const [vx, vy, vw, vh] = DAMPER_STATIC.viewBox;
  const showText = engraving ?? size >= 140;
  const frontClip = `${id}-front`;
  const backClip = `${id}-back`;

  function bladePath(key: (typeof BLADE_PARTS)[number]) {
    return (
      <path
        ref={(el) => {
          paths.current[key] = el;
        }}
        d={initial[key]}
        className={BLADE}
        style={{ fill: initial.fill }}
      />
    );
  }

  function edgePath(key: (typeof EDGE_PARTS)[number]) {
    return (
      <path
        ref={(el) => {
          paths.current[key] = el;
        }}
        d={initial[key]}
        className={EDGE}
      />
    );
  }

  return (
    <span
      data-slot="damper-module"
      data-state={state}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
      onPointerDown={() => {
        // Touch has no hover: a tap plays the air for a while.
        setTail(true);
        setTimeout(() => setTail(false), AIR_TAIL_MS);
      }}
      style={{ width: size, height: (size * vh) / vw }}
      className={cn(
        "group/dm inline-block flex-none leading-none data-[state=offline]:opacity-70",
        "[&_line]:[vector-effect:non-scaling-stroke] [&_path]:[vector-effect:non-scaling-stroke]",
        className,
      )}
    >
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        width="100%"
        height="100%"
        className="overflow-visible"
      >
        <defs>
          <clipPath id={frontClip}>
            <path d={DAMPER_STATIC.frontBore} />
          </clipPath>
          <clipPath id={backClip}>
            <path d={DAMPER_STATIC.backBore} />
          </clipPath>
        </defs>
        <path
          d={DAMPER_STATIC.silhouette}
          className="fill-(--damper-body) stroke-(--damper-rim) [stroke-width:1]"
        />
        <path d={DAMPER_STATIC.frontBore} className="fill-(--damper-inner)" />
        <g clipPath={`url(#${frontClip})`}>
          <path d={DAMPER_STATIC.backBore} className="fill-(--dm-ground,var(--card))" />
          <g ref={inner} className={AIR} />
          <g clipPath={`url(#${backClip})`}>
            {bladePath("back")}
            {edgePath("edgeBack")}
          </g>
          {bladePath("mid")}
          {edgePath("edgeMid")}
          <path
            d={DAMPER_STATIC.axle}
            className="fill-none stroke-(--damper-blade-edge) [stroke-width:1.4] [stroke-linecap:round]"
          />
        </g>
        <g className="group-data-[state=offline]/dm:opacity-55 group-data-[state=offline]/dm:grayscale">
          <path d={DAMPER_STATIC.plate.front} className="fill-(--damper-body)" />
          <path d={DAMPER_STATIC.plate.side} className="fill-(--damper-inner)" />
          <path d={DAMPER_STATIC.plate.top} className="fill-(--damper-rim)" />
          <path
            d={DAMPER_STATIC.servo.front}
            className="fill-(--damper-servo) stroke-(--damper-servo-ink) [stroke-width:.8] [stroke-linejoin:round]"
          />
          <path
            d={DAMPER_STATIC.servo.side}
            className="fill-[color-mix(in_oklab,var(--damper-servo)_74%,#000)] stroke-(--damper-servo-ink) [stroke-width:.8] [stroke-linejoin:round]"
          />
          <path
            d={DAMPER_STATIC.servo.top}
            className="fill-[color-mix(in_oklab,var(--damper-servo)_78%,#fff)] stroke-(--damper-servo-ink) [stroke-width:.8] [stroke-linejoin:round]"
          />
          {showText && (
            <text
              transform={DAMPER_STATIC.engrave}
              x="0"
              y="0"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-(--damper-servo-ink) font-sans text-[15px] font-bold tracking-[.01em]"
            >
              luftuj.cz
            </text>
          )}
        </g>
        <path d={DAMPER_STATIC.rimFace} fillRule="evenodd" className="fill-(--damper-rim)" />
        {DAMPER_STATIC.ribs.map((d) => (
          <path
            key={d}
            d={d}
            className="fill-none stroke-(--damper-body) [stroke-width:1.2] opacity-90"
          />
        ))}
        {bladePath("front")}
        {edgePath("edgeFront")}
        <g ref={outer} className={AIR} />
      </svg>
    </span>
  );
}
