import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface TickingAgeLabelProps {
  timestamp: number | null;
  children: (seconds: number) => ReactNode;
}

export function TickingAgeLabel({ timestamp, children }: Readonly<TickingAgeLabelProps>) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (timestamp == null) return;
    // Measure age client-side: reset to 0 when a fresh backend read arrives
    // (new timestamp), then tick up locally. Subtracting the backend's
    // fetchedAt from the browser's Date.now() mixed two clocks — container
    // vs. browser skew offset the age by several seconds (never started at 0),
    // and Math.round on that diff produced the skipped values.
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null) return null;

  return children(seconds);
}
