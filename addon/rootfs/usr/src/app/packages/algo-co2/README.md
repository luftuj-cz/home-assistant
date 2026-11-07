# LUFTaTOR Algo CO2

Automatic mode for a multi-zone ventilation system with heat recovery: it moves valves and the
HRU power so that CO2 in every room stays near an optimal level without oscillating.

The package is standalone on purpose. It has no runtime dependencies, uses no Node or browser
globals, and knows nothing about the backend around it. The backend imports it; it never imports
the backend.

Ported from `luftuj-tools/homeassistant-engine` at commit `b429c36` (2026-07-19). Behaviour is
unchanged; the scenario tests carry over with their original expected journals.

## Usage

```ts
import {
  AutomaticModeEngine,
  Box,
  Building,
  Room,
  Sensor,
  Timestamp,
  Valve,
  ValveType,
  type HRU,
} from "@luftator/algo-co2";

const sensor = new Sensor("sensor_obyvak");
const room = new Room("obyvak", [sensor]);
const building = new Building(
  [room],
  [new Box([new Valve("obyvak_privod", 0, room, ValveType.Supply)])],
);

const hru: HRU = { getPower: () => currentPower, setPower: (power) => writePower(power) };
const engine = new AutomaticModeEngine(building, hru, logger); // logger: anything with info(message)

// once per tick
sensor.co2 = latestReading; // null when the sensor has no value
const report = engine.run(Timestamp.now());
// read valve.value for the new positions
```

`HRU` is synchronous, and the engine writes positions straight into `Valve.value`. The
`onValveChange` callback exists but the engine does not call it yet.

`run()` returns a `RunReport` describing how it decided; the engine behaves the same whether or
not the caller reads it. Besides the `branch` (see Algorithm), it lists the rooms by id, unique
and in `building.rooms` order:

- `roomsWithReading`: rooms with a CO2 value.
- `roomsAboveTh2`, `roomsAboveTh1`, `roomsBelowTh1`: rooms that have been above TH2, above TH1 or
  below TH1 - hysteresis for `thresholdTimeLimit`.
- `roomsInCooldown`: rooms with a reading that the engine acted on within `thresholdTimeLimit` before
  this run. It is the state before the run: a room acted on in this run is not listed in the same report.
- `roomsActedOn`: rooms the engine marked as changed in this run.

- `roomsAboveFluctuation`: rooms at or above the fluctuation level (`TH1 - fluctuationOffset`) for
  `thresholdTimeLimit`. Reported whether or not fluctuation is enabled.

It also reports `valvesChanged` (whether any valve moved), `powerBefore` and `powerAfter` (the HRU
power around the run), `maxPower` (the day or night maximum at that timestamp) and
`fluctuationActive` (the fluctuation state after the run).

## Model

- **Building**: rooms plus boxes; `getAllValves()` flattens the valves of every box.
- **Room**: its CO2 is the **maximum** over sensors that report a value, or `null` if none do.
- **Box**: a physical unit holding valves.
- **Valve**: id, default position, owning room, `Supply` or `Exhaust`. Position `0` is fully
  open; higher values close it further.
- **Sensor**: id and a `co2` reading (`number | null`).

## Algorithm

Every `run(timestamp)`:

1. Smooths each room's CO2 with an exponential moving average (`co2FilterAlpha`). A room without
   a reading drops out of the decision, and its valves open fully whenever the engine
   redistributes the airflow.
2. Tracks, per room and threshold (TH1, TH2), since when the smoothed CO2 has been at or above
   the threshold, and since when it has been below `threshold - co2Hysteresis`.
3. Counts a room as above or below a threshold only after `thresholdTimeLimit` seconds there.
4. Updates the fluctuation state (see below).
5. Acts on the first branch that applies, and reports it as `RunReport.branch`:
   - **A room above TH2** (`th2`): rooms above TH1 or TH2 open fully, all other rooms close partially,
     and the HRU power rises by one step (capped by the day or night maximum). The power step
     happens at most once per `thresholdTimeLimit` for the rooms involved.
   - **A room above TH1** (`th1`) that the engine has not acted on within `thresholdTimeLimit`:
     every room above TH1 opens fully, including rooms acted on more recently, and every other room
     closes partially. Only the rooms out of that window are marked as acted on. When every room
     above TH1 is still within the window the branch is `th1` all the same, but nothing changes.
   - **Fluctuation is active** (`fluctuation`): valves return to their defaults and the HRU power moves
     to `hruMovePower` (Pmove): up in one write, down by one step per run. Pmove is kept at or above
     `hruMinPower` and capped by the day or night maximum. No room is marked as acted on, so a room that
     then crosses TH1 is handled at once.
   - **Every room with a reading below TH1 - hysteresis** (`allBelow`): valves return to their
     defaults and the HRU power drops by one step on every tick, down to `hruMinPower`. This also
     applies when no room has a reading.
   - Otherwise (`none`) nothing changes: the hysteresis band, or a state that has not yet lasted
     `thresholdTimeLimit`.

### Fluctuation

People moving around the house raise CO2 a little in several rooms without any of them reaching TH1.
Without this feature the engine would treat that as "all below TH1" and lower the power to the minimum.
Fluctuation is on by default (`fluctuationEnabled`, `true`); turned off, the engine behaves as if it did
not exist.

- The fluctuation level is `TH1 - fluctuationOffset` (700 ppm by default). Per room the engine tracks
  since when the smoothed CO2 has been at or above it and since when below it, with no hysteresis: a
  crossing restarts the other timer, and a room without a reading has both timers cleared.
- **On**: at least two rooms have been at or above the level for `thresholdTimeLimit` and no room is
  above TH1 or TH2 for `thresholdTimeLimit`.
- **Stays on**, also through a TH1 or TH2 episode, until every room with a reading has been below the
  level for `thresholdTimeLimit`, so it does not flap around the level. It goes off at once when
  `fluctuationEnabled` is cleared or no room has a reading.

While it is on, the power never falls below Pmove: only `allBelow` lowers power below it, and that
branch comes after `fluctuation`.

## Parameters

Public fields on `AutomaticModeEngine`, with their defaults:

| Field                               | Default           | Meaning                                      |
| ----------------------------------- | ----------------- | -------------------------------------------- |
| `thresholds`                        | TH1 800, TH2 1200 | CO2 thresholds in ppm                        |
| `co2Hysteresis`                     | 50                | ppm below a threshold that counts as "under" |
| `thresholdTimeLimit`                | 120               | seconds a state must last before it counts   |
| `co2FilterAlpha`                    | 0.3               | weight of the newest reading in the filter   |
| `hruMinPower`                       | 20                | lowest HRU power                             |
| `hruMaxPowerDay`/`hruMaxPowerNight` | 100 / 50          | highest HRU power by time of day             |
| `hruPowerStep`                      | 10                | HRU power change per step                    |
| `hruMovePower`                      | 40                | HRU power while fluctuation is on (Pmove)    |
| `fluctuationEnabled`                | `true`            | turns fluctuation on                         |
| `fluctuationOffset`                 | 100               | ppm below TH1 where fluctuation starts       |
| `partialCloseValue`                 | 45                | position of a partially closed valve         |
| `fullyOpenValue`                    | 0                 | position of a fully open valve               |
| `dayStart`/`dayEnd`                 | 07:00 / 22:00     | day window, in seconds of the day            |

`Timestamp.now()` takes the time of day from the process's local time zone.

## Tests

```bash
npm test          # in this directory: only this package
npm test          # in the backend or repo root: backend and this package
```

The scenarios in `tests/engine.test.ts` drive the engine one simulated second at a time with
`SensorSimulator` (linear interpolation between CO2 points) and compare the journal: with
`useJournal = true` the engine records `epochSecond,power,valve:position,...` on every change,
entries joined by `;`.

## Staying standalone

- `package.json` has no `dependencies`; Vitest and TypeScript are dev-only.
- `tsconfig.json` sets `"types": []`, so Node and DOM globals do not type-check.
- Oxlint (`oxlint.config.ts` in the repo root) rejects any non-relative import in `src/` and any
  import that leaves the package; tests may import Vitest as well.
