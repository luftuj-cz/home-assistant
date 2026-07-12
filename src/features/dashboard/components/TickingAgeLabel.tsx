import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface TickingAgeLabelProps {
  timestamp: number | null;
  children: (seconds: number) => ReactNode;
}

export function TickingAgeLabel({ timestamp, children }: Readonly<TickingAgeLabelProps>) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null) return null;

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return children(seconds);
}
