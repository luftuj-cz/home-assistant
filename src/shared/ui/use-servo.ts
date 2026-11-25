import { useEffect, useLayoutEffect, useRef, useState } from "react";

function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Spring stiffness (rad/s), damping ratio and speed cap (°/s, the real servo turns ~500°/s). */
const STIFFNESS = 24;
const DAMPING = 0.68;
const MAX_SPEED = 420;

/**
 * Moves like the SG90-class servo on the damper: a stiff, slightly under-damped spring with a speed cap, so the blade
 * overshoots by about 5% and settles in ~300 ms. Frames go straight to `onFrame` (write them to the DOM); React
 * renders only when motion starts and stops. With reduced motion the value jumps.
 *
 * Returns `start`, the value at mount (render with it once and let `onFrame` take over), and `moving`.
 */
export function useServo(target: number, onFrame: (value: number) => void) {
  const state = useRef({ x: target, v: 0, raf: 0, last: 0 });
  const callback = useRef(onFrame);
  const [start] = useState(target);
  const [moving, setMoving] = useState(false);

  useLayoutEffect(() => {
    callback.current = onFrame;
  });

  useEffect(() => {
    const s = state.current;
    if (Math.abs(s.x - target) < 0.05) {
      // Retargeted back to where the blade already is: nothing to animate.
      setMoving(false);
      return;
    }
    if (prefersReducedMotion()) {
      s.x = target;
      s.v = 0;
      callback.current(target);
      return;
    }
    cancelAnimationFrame(s.raf);
    s.last = performance.now();
    setMoving(true);
    function tick(now: number) {
      const dt = Math.min(0.032, (now - s.last) / 1000);
      s.last = now;
      s.v += (STIFFNESS * STIFFNESS * (target - s.x) - 2 * DAMPING * STIFFNESS * s.v) * dt;
      s.v = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s.v));
      s.x += s.v * dt;
      if (Math.abs(target - s.x) < 0.05 && Math.abs(s.v) < 0.6) {
        s.x = target;
        s.v = 0;
        callback.current(target);
        setMoving(false);
        return;
      }
      callback.current(s.x);
      s.raf = requestAnimationFrame(tick);
    }
    s.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(s.raf);
  }, [target]);

  return { start, moving };
}

/** The same motion as a React value, for simple consumers. */
export function useServoAngle(target: number) {
  const [angle, setAngle] = useState(target);
  useServo(target, setAngle);
  return angle;
}
