import { cn } from "@luftuj/shared/utils/cn";

export interface StripEvent {
  /** "HH:MM". */
  time: string;
  color: string;
}

interface DayStripProps {
  events: StripEvent[];
  /** "HH:MM": draws the now-needle (today only). */
  now?: string;
  /** Colour of the mode carried over from the day before, drawn at 35 % until the first event. */
  carry?: string;
  /** Track colour and height; `bg-card` inside a muted well. */
  trackClassName?: string;
  /** The 00/06/12/18/24 scale under the bar; WeekOverview draws one for all rows. */
  scale?: boolean;
  className?: string;
}

function minutes(time: string) {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const SCALE = ["00", "06", "12", "18", "24"];

/** 00 06 12 18 24 under a strip. */
export function StripScale({ className }: Readonly<{ className?: string }>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex justify-between font-mono text-[10px] leading-3 text-muted-foreground",
        className,
      )}
    >
      {SCALE.map((hour) => (
        <span key={hour}>{hour}</span>
      ))}
    </div>
  );
}

/** The day as 24 hours of mode-coloured segments with a 00/06/12/18/24 scale. Each event runs until the next one. */
export function DayStrip({
  events,
  now,
  carry,
  trackClassName = "bg-muted",
  scale = true,
  className,
}: Readonly<DayStripProps>) {
  const sorted = events.toSorted((a, b) => minutes(a.time) - minutes(b.time));
  const segments: { from: number; to: number; color: string; carry?: boolean }[] = [];
  const first = sorted[0];
  if (carry && (!first || minutes(first.time) > 0)) {
    segments.push({ from: 0, to: first ? minutes(first.time) : 1440, color: carry, carry: true });
  }
  sorted.forEach((event, index) => {
    const next = sorted[index + 1];
    segments.push({
      from: minutes(event.time),
      to: next ? minutes(next.time) : 1440,
      color: event.color,
    });
  });

  return (
    <div data-slot="day-strip" aria-hidden="true" className={cn("grid gap-1", className)}>
      <span className="relative block">
        <span className={cn("relative block h-3 overflow-hidden rounded-full", trackClassName)}>
          {segments.map((segment) => (
            <span
              key={`${segment.from}-${segment.color}`}
              className={cn(
                "absolute inset-y-0 shadow-[inset_-1.5px_0_0_var(--card)] transition-[left,width] duration-(--duration-slow) ease-(--ease-out)",
                segment.carry && "opacity-35",
              )}
              style={{
                left: `${(segment.from / 1440) * 100}%`,
                width: `${((segment.to - segment.from) / 1440) * 100}%`,
                background: segment.color,
              }}
            />
          ))}
        </span>
        {now !== undefined && (
          <span
            className="absolute -inset-y-0.5 -ml-px w-0.5 rounded-[1px] bg-foreground shadow-[0_0_0_2px_var(--card)] transition-[left] duration-600 ease-(--ease-in-out)"
            style={{ left: `${(minutes(now) / 1440) * 100}%` }}
          />
        )}
      </span>
      {scale && <StripScale />}
    </div>
  );
}
