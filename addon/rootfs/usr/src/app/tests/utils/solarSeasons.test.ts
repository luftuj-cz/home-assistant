import { describe, expect, it } from "vitest";

import { solarEvent, type SolarEvent } from "../../src/utils/solarSeasons.js";

const EVENTS: readonly SolarEvent[] = [
  "marchEquinox",
  "juneSolstice",
  "septemberEquinox",
  "decemberSolstice",
];

/**
 * Published instants in Czech civil time, from kalendar.beda.cz. The sample is
 * picked for the years that break the "spring is always 20 March" assumption
 * this module exists to replace: 2028, 2044 and 2048 put the June solstice on
 * the 20th, 2027 puts the December solstice on the 22nd, 2048 puts the March
 * equinox on the 19th, and the 2044 equinox lands 20 minutes past midnight,
 * which is where dropping the dynamical-time correction would flip a date.
 */
const REFERENCE: Record<number, readonly [string, string][]> = {
  1951: [
    ["03-21", "11:26"],
    ["06-22", "06:25"],
    ["09-23", "21:37"],
    ["12-22", "17:00"],
  ],
  2025: [
    ["03-20", "10:01"],
    ["06-21", "04:42"],
    ["09-22", "20:19"],
    ["12-21", "16:03"],
  ],
  2026: [
    ["03-20", "15:46"],
    ["06-21", "10:24"],
    ["09-23", "02:05"],
    ["12-21", "21:50"],
  ],
  2027: [
    ["03-20", "21:25"],
    ["06-21", "16:11"],
    ["09-23", "08:02"],
    ["12-22", "03:42"],
  ],
  2028: [
    ["03-20", "03:17"],
    ["06-20", "22:02"],
    ["09-22", "13:45"],
    ["12-21", "09:20"],
  ],
  2044: [
    ["03-20", "00:20"],
    ["06-20", "18:51"],
    ["09-22", "10:48"],
    ["12-21", "06:43"],
  ],
  2048: [
    ["03-19", "23:34"],
    ["06-20", "17:54"],
    ["09-22", "10:00"],
    ["12-21", "06:02"],
  ],
  2050: [
    ["03-20", "11:19"],
    ["06-21", "05:33"],
    ["09-22", "21:28"],
    ["12-21", "17:38"],
  ],
};

/**
 * Formats in Prague explicitly rather than in the host zone, so the expected
 * values stay the published ones wherever the suite runs.
 */
const PRAGUE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function inPrague(date: Date): { monthDay: string; minutes: number } {
  const parts = Object.fromEntries(PRAGUE.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    monthDay: `${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

describe("solarEvent", () => {
  it("reproduces the published dates", () => {
    for (const [year, rows] of Object.entries(REFERENCE)) {
      const actual = EVENTS.map((event) => inPrague(solarEvent(Number(year), event)).monthDay);
      expect(actual, `year ${year}`).toEqual(rows.map(([monthDay]) => monthDay));
    }
  });

  it("lands within two minutes of the published instant", () => {
    for (const [year, rows] of Object.entries(REFERENCE)) {
      EVENTS.forEach((event, index) => {
        const [, expectedTime] = rows[index]!;
        const [hours, minutes] = expectedTime.split(":").map(Number);
        const expected = hours! * 60 + minutes!;
        const actual = inPrague(solarEvent(Number(year), event)).minutes;
        expect(Math.abs(actual - expected), `${year} ${event}`).toBeLessThanOrEqual(2);
      });
    }
  });

  /**
   * Meeus, example 27.a: the June solstice of 1962 at JDE 2437837.39245 in
   * Dynamical Time, which is 21:24:35 UT once that year's real dT of 34s is
   * taken off. Ours lands about half a minute earlier because deltaTSeconds
   * extrapolates its 2005-2050 polynomial back to 1962 - tens of seconds, which
   * is why the tolerance is a minute and why it can never move a date.
   */
  it("reproduces the worked example from Meeus", () => {
    const expected = Date.UTC(1962, 5, 21, 21, 24, 35);
    const actual = solarEvent(1962, "juneSolstice").getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(60_000);
  });

  it("orders the four events within the year", () => {
    const times = EVENTS.map((event) => solarEvent(2026, event).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
