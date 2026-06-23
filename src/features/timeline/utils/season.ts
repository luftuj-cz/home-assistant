import type { Hemisphere, Season } from "@luftuj/shared/types/timeline";

const NORTHERN_BOUNDARIES: ReadonlyArray<{ start: string; season: Season }> = [
  { start: "03-20", season: "spring" },
  { start: "06-21", season: "summer" },
  { start: "09-22", season: "autumn" },
  { start: "12-21", season: "winter" },
];

const SOUTHERN_FLIP: Record<Season, Season> = {
  spring: "autumn",
  summer: "winter",
  autumn: "spring",
  winter: "summer",
};

function northernSeason(month: number, day: number): Season {
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  let result: Season = "winter";
  for (const b of NORTHERN_BOUNDARIES) {
    if (md >= b.start) result = b.season;
  }
  return result;
}

export function resolveSeason(now: Date, hemisphere: Hemisphere): Season {
  const season = northernSeason(now.getUTCMonth() + 1, now.getUTCDate());
  return hemisphere === "southern" ? SOUTHERN_FLIP[season] : season;
}
