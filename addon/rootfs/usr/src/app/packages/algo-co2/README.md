# LUFTaTOR Algo CO2

Automatic mode for a multi-zone ventilation system with heat recovery: it moves valves and the
HRU power so that CO2 in every room stays near an optimal level without oscillating.

The package is standalone on purpose. It has no runtime dependencies, uses no Node or browser
globals, and knows nothing about the backend around it. The backend imports it; it never imports
the backend.

Ported from `luftuj-tools/homeassistant-engine` at commit `b429c36` (2026-07-19). Behaviour has moved
on since: the scenario tests in `tests/engine.test.ts` come from the original, and all five of their
expected journals were re-baselined on 2026-11-20 (an earlier first TH2 power step, a filter that
keeps its precision, and the power review in the TH1 band).

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

`HRU` is synchronous, and the engine writes positions straight into `Valve.value`; `RunReport.valvesChanged`
says whether a run moved any. `HRU` power is on the engine's
0–10 scale (see Power scale), so `currentPower` and `writePower` above convert to and from the
unit's own values.

`run()` returns a `RunReport` describing how it decided; the engine behaves the same whether or
not the caller reads it. Besides the `branch` (see Algorithm), it lists the rooms by id, unique
and in `building.rooms` order:

- `roomsWithReading`: rooms with a CO2 value.
- `roomsAboveTh2`, `roomsAboveTh1`: rooms that have been above TH2 or TH1 for `thresholdTimeLimit`
  (Tzone).
- `roomsBelowTh1`: rooms that have been below TH1 minus its hysteresis for `belowTimeLimit` (Topen).
- `roomsInCooldown`: rooms with a reading that the engine acted on within `thresholdTimeLimit` before
  this run. It is the state before the run: a room acted on in this run is not listed in the same report.
- `roomsActedOn`: rooms the engine marked as changed in this run.
- `roomsAboveFluctuation`: rooms at or above the fluctuation level (`TH1 - fluctuationOffset`) for
  `thresholdTimeLimit`. Reported whether or not fluctuation is enabled.

It also reports `valvesChanged` (whether any valve moved), `powerBefore` and `powerAfter` (the HRU
power around the run), `maxPower` (the day or night maximum at that timestamp, which `powerAfter` never exceeds), all on the 0–10 scale, and
`fluctuationActive` (the fluctuation state after the run).

`powerReview` says what a power review decided (see Power review): `null` in a run without one,
otherwise the `lane` (`"fast"` or `"slow"`), `raised` (whether a room asked for power; the step itself
may have been capped by the maximum), and the rooms that `asked` and the reviewed rooms that were
`held`. A slow-lane step is not an action on a room and does not appear in `roomsActedOn`.

## Model

- **Building**: rooms plus boxes; `getAllValves()` flattens the valves of every box.
- **Room**: its CO2 is the **maximum** over sensors that hold a reading, or `null` if none do.
- **Box**: a physical unit holding valves.
- **Valve**: id, default position, owning room, `Supply` or `Exhaust`. Position `0` is fully
  open; higher values close it further. The engine carries the type but does not use it: supply and
  exhaust valves are treated alike, and the valves of a room without sensors open fully whenever the
  airflow is redistributed.
- **Sensor**: id and a `co2` reading (`number | null`), `null` until the caller writes one.

A reading is a finite number above 0. Anything else in `Sensor.co2` (`null`, `undefined`, `NaN`,
infinity, `0`, a negative number, a string) is no reading, and that sensor is left out of its room's
CO2. There is no upper limit: a sensor stuck at its ceiling still means "ventilate". Convert Home
Assistant states yourself; `Number("unavailable")` is `NaN`, which the engine ignores.

The engine sees a value, not its age. If a reading is too old to trust (a sensor frozen at its last
value), write `null`.

## Algorithm

Every `run(timestamp)`:

1. Smooths each room's CO2 with an exponential moving average (`co2FilterAlpha`, the weight of the
   newest reading per second of elapsed time, see Run period). A room without
   a reading (see Model for what counts as one) drops out of the decision, and its valves open fully
   whenever the engine redistributes the airflow. When a reading returns, the average starts again
   from it.
2. Tracks, per room and threshold (TH1, TH2), since when the smoothed CO2 has been at or above
   the threshold, and since when it has been below `threshold - hysteresis`, where each threshold
   has its own hysteresis in `co2Hysteresis` (TH1diff, TH2diff). The smoothed value is kept unrounded
   and compared in whole ppm. A room's first reading decides its state: below the threshold it is
   "below", also inside the hysteresis band; the hysteresis only applies to leaving "above".
3. Counts a room as above a threshold only after `thresholdTimeLimit` seconds there (Tzone), and as
   below one only after `belowTimeLimit` seconds (Topen).
4. Updates the fluctuation state (see below).
5. Brings an HRU power outside the limits back in one write, in every branch: down to the day or night
   maximum, up to `hruMinPower` (where the minimum is above the maximum, the maximum wins). This is not
   an action on a room: no room is marked as acted on and the reported branch does not change; the
   run's `powerBefore` and `powerAfter` show it. A write the unit does not follow is tried again once
   per `thresholdTimeLimit`, not on every run.
6. Acts on the first branch that applies, and reports it as `RunReport.branch`:
   - **A room above TH2** (`th2`): rooms above TH1 or TH2 open fully, all other rooms close partially,
     and the fast lane of the power review may raise the HRU power by one step (capped by the day or
     night maximum), at most once per `thresholdTimeLimit` for the rooms involved and on a timer of its
     own: the first step comes as soon as a room has been above TH2 for `thresholdTimeLimit`, whatever
     the `th1` branch did with that room before. Later steps need a room that is really at or above
     TH2 and not falling (see Power review).
   - **A room above TH1** (`th1`) that the engine has not acted on within `thresholdTimeLimit`:
     every room above TH1 opens fully, including rooms acted on more recently, and every other room
     closes partially. Only the rooms out of that window are marked as acted on. When every room
     above TH1 is still within the window the branch is `th1` all the same, and the valves stay. The
     slow lane of the power review may raise the HRU power here (see Power review).
   - **Fluctuation is active** (`fluctuation`): valves return to their defaults and the HRU power moves
     to `hruMovePower` (Pmove): up in one write, down by one step per
     `hruPowerStepDownInterval` while the step-down gate is open (see Power review). Pmove is kept at
     or above
     `hruMinPower` and capped by the day or night maximum. No room is marked as acted on, so a room that
     then crosses TH1 is handled at once.
   - **Every room with a reading below TH1 - hysteresis** (`allBelow`): valves return to their
     defaults and the HRU power drops by one step per `hruPowerStepDownInterval`, down to
     `hruMinPower`, while the step-down gate is open (see Power review). This also applies when no
     room has a reading.
   - Otherwise (`none`) nothing changes: a state that has not yet lasted its time limit.

While the engine runs, it owns the HRU power: a power set outside the limits from outside is brought
back on the next run, and a unit that reads 0 is raised to `hruMinPower`. Do not call `run()` while another mode (a boost, a schedule override) controls the unit.

### Power review

The power goes up while a room at or above TH1 is not getting better, holds while it is, and comes
down slowly once every room is below TH1.

- **Falling.** A room above TH1 keeps a window: its filtered CO2 in whole ppm averaged over the time
  since its previous review, weighted by elapsed time. A room is falling when the average is lower than
  the previous window's by more than `co2FallingMargin` (10 ppm). Averages, because with a sample every
  30 s and ordinary sensor noise two single values say nothing about ten minutes of a room.
- **Slow lane** (a room above TH1). One clock for the whole engine. It starts in the first `th1` or `th2`
  run of a stretch, when the valves have just been redistributed, and takes no step then. Every
  `powerReviewInterval` (600 s) the rooms above TH1 are reviewed, and the power rises by one step when
  one of them asks: its average is at or above TH1 and it is not falling. One step per review however
  many rooms ask. A room held in the above-TH1 state by the hysteresis but under TH1 (750 to 799 ppm
  by default) asks for nothing.
- **The guard.** A room stops asking once `powerReviewStepLimit` (3) of its asks have raised the power;
  an ask at the maximum raises nothing and does not count. The count returns to 0 when a review finds
  the room falling or under TH1, and when it leaves the above-TH1 state. It is there for rooms that do
  not respond to power, such as a sensor stuck just above TH1. A room that is clearly getting worse,
  its average up by more than twice the margin, asks whatever its count.
- **Fast lane** (a room above TH2). The rooms due for a TH2 step are reviewed with windows of their own.
  A room takes part once it has been above TH2 for `thresholdTimeLimit`. It asks on its first review of
  the episode, and afterwards when its average is at or above TH2 and it is not falling. Rooms that are only above TH1 do not cause a fast step.
  After a fast step the slow lane waits one interval; a room stuck between TH2 minus its hysteresis and
  TH2 is picked up by the slow lane.
- **The way down.** A step down in `allBelow`, or toward Pmove in `fluctuation`, needs the gate open:
  every room with a reading below TH1 minus its hysteresis right now, and no room held above TH1 by a
  missing reading. The first step needs a full `hruPowerStepDownInterval` (300 s) of open gate, and each
  further step another interval; a closed gate pauses the count, and leaving these two branches clears
  it. A room climbing through 750 ppm stops the descent before the next step. The power is never lowered while a room is above TH1.
- **A silent sensor.** A room that was above TH1 when its sensor stopped reporting keeps the gate closed
  and its place in the review for `missingReadingHold` (3600 s). After that it no longer counts, and
  starts over when a reading returns.

A power step from the slow lane shows in `powerReview` and in `powerBefore` / `powerAfter`; it does not
touch the valve cooldown.

### Run period

`run()` may be called at any period; nothing is counted per call.

- **Filter.** `co2FilterAlpha` is the weight of the newest reading per second. After `dt` seconds since
  the room's previous filtered value the weight is `1 - (1 - alpha)^dt`, so the filtered value follows
  the same course in time whatever the period (within the whole-ppm rounding). As a time constant,
  `alpha` is `-1 / ln(1 - alpha)` seconds: 2.8 s at the default 0.3, which smooths nothing when sensors
  report every 30 s. Two runs with the same timestamp filter once.
- **Power on the way down.** One step of `hruPowerStep` takes `hruPowerStepDownInterval` seconds of an
  open step-down gate (see Power review). The seconds are counted between runs, so a run that comes
  after several intervals takes several steps and the rest is carried over. A value that is not a
  finite number above 0 means no pace limit. With the default of 300 s the power goes from 10 to 2 in
  40 minutes: the first step five minutes after the gate opened, the last after forty.
- **Power review.** The windows are weighted by the seconds between runs, so a review decides the same
  at a 1 s and a 60 s period. Reviews are at least `powerReviewInterval` apart, at the first run after
  the interval. Keep the period short against the intervals: with a period near `powerReviewInterval`
  a window holds one or two readings.
- **Timed decisions** (Tzone, Topen, the cooldown) compare seconds. A crossing is noticed at the first
  run after it happens and acted on at the first run after its limit, so a decision can come up to two
  periods late. Keep the period short against `thresholdTimeLimit` and `belowTimeLimit`.

The engine keeps the time of the previous run. After a long pause, create a new engine rather than
resuming the old one: its timers would describe the house as it was before the pause.

### Fluctuation

People moving around the house raise CO2 a little in several rooms without any of them reaching TH1.
Without this feature the engine would treat that as "all below TH1" and lower the power to the minimum.
Fluctuation is on by default (`fluctuationEnabled`, `true`); turned off, the engine behaves as if it did
not exist.

- The fluctuation level is `TH1 - fluctuationOffset` (700 ppm by default). Per room the engine tracks
  since when the smoothed CO2 has been at or above it and since when below it, with no hysteresis: a
  crossing restarts the other timer, and a room without a reading has both timers cleared.
- **On**: at least two rooms have been at or above the level for `thresholdTimeLimit` (Tzone) and no
  room is above TH1 or TH2 for `thresholdTimeLimit`.
- **Stays on**, also through a TH1 or TH2 episode, until every room with a reading has been below the
  level for `belowTimeLimit` (Topen), so it does not flap around the level. It goes off at once when
  `fluctuationEnabled` is cleared or no room has a reading.

While it is on, the power never falls below Pmove: only `allBelow` lowers power below it, and that
branch comes after `fluctuation`.

### Power scale

Every power the engine reads or writes is on one scale for every HRU: 0 is zero power, 10 is the
unit's maximum, decimals allowed. The engine rounds what it writes to two decimals. Converting is the
caller's job:

- writing: `unitValue = power / 10 × unitMax`, rounded to the unit's step and kept within its range;
- reading: `power = unitValue / unitMax × 10`;
- `unitMax` comes from the unit definition, or from the installer where the definition has none.

For a VENTBOX 400 (400 m³/h), the project values Pmin 80, Pmax 400 / 280 and Pmove 153 m³/h are 2,
10 / 7 and 3.8.

## Parameters

Public fields on `AutomaticModeEngine`, with their defaults:

| Field                               | Default           | Meaning                                       |
| ----------------------------------- | ----------------- | --------------------------------------------- |
| `thresholds`                        | TH1 800, TH2 1200 | CO2 thresholds in ppm                         |
| `co2Hysteresis`                     | TH1 50, TH2 100   | ppm below a threshold that counts as "under"  |
| `thresholdTimeLimit`                | 120               | Tzone: seconds above a threshold; cooldown    |
| `belowTimeLimit`                    | 120               | Topen: seconds below a threshold              |
| `co2FilterAlpha`                    | 0.3               | weight of the newest reading, per second      |
| `hruMinPower`                       | 2                 | lowest HRU power (0–10)                       |
| `hruMaxPowerDay`/`hruMaxPowerNight` | 10 / 5            | highest HRU power by time of day (0–10)       |
| `hruPowerStep`                      | 1                 | HRU power change per step (0–10)              |
| `hruPowerStepDownInterval`          | 300               | seconds one step down takes                   |
| `powerReviewInterval`               | 600               | seconds between slow-lane power reviews       |
| `co2FallingMargin`                  | 10                | ppm of drop between reviews that is "falling" |
| `powerReviewStepLimit`              | 3                 | slow-lane asks in a row per room (the guard)  |
| `missingReadingHold`                | 3600              | seconds a silent room above TH1 still counts  |
| `hruMovePower`                      | 4                 | HRU power while fluctuation is on, Pmove      |
| `fluctuationEnabled`                | `true`            | turns fluctuation on                          |
| `fluctuationOffset`                 | 100               | ppm below TH1 where fluctuation starts        |
| `partialCloseValue`                 | 45                | position of a partially closed valve          |
| `fullyOpenValue`                    | 0                 | position of a fully open valve                |
| `dayStart`/`dayEnd`                 | 07:00 / 22:00     | day window, in seconds of the day             |

The defaults are placeholders: every installation sets its own thresholds, powers and day window.
`getParameterProblems()` returns what is wrong with the current values, one message per problem (TH2
not above TH1, a minimum above a maximum, a step of 0, a partially closed position that is not more
closed than the open one, …) and an empty list when nothing is. The engine never calls it and never
throws because of a parameter.

`dayStart` after `dayEnd` is a day that runs through midnight; both ends count as day either way.
`Timestamp.now()` takes the time of day from the process's local time zone, so an integration that
knows the house's time zone builds the `Timestamp` itself.

## What the caller must do

The engine cannot do these on its own:

- **Valve positions at start.** A valve is moved only when `Valve.value` differs from what the engine
  wants, and `Valve.value` starts at 0, which is also "fully open". Set it from the real positions
  before the first run, or write every position once after it; otherwise valves left partially closed
  before a restart are never opened.
- **A unit that is off.** Do not call `run()` then. The engine would raise the power to `hruMinPower`
  and, as the unit does not follow, write it again once per `thresholdTimeLimit`.
- **Readings.** Pass `null` for a reading that is too old, and convert Home Assistant states yourself
  (see Model).
- **A sensor that is wrong.** A reading stuck just above TH1 holds up to `powerReviewStepLimit` extra
  power steps for as long as it is stuck, and a noisy one that hovers there can work the power up to
  the maximum over a day or two: nothing lowers the power while a room is above TH1. Watch for a room
  that never leaves the above-TH1 state.
- **A sensor that is dead.** After `missingReadingHold` the engine stops holding the power for its room
  and the room is on its own, as with any room without a reading. Report dead sensors to the user.
- **Parameters.** Call `getParameterProblems()` after applying settings and decide what to do with
  the answer.

`getRoomState()` exposes the engine's own state for display; its `filteredCO2` is the unrounded value,
`getFilteredCO2()` the one in whole ppm that the engine compares.

## Tests

```bash
npm test          # in this directory: only this package
npm test          # in the backend or repo root: backend and this package
```

The scenarios in `tests/engine.test.ts` drive the engine one simulated second at a time with
`SensorSimulator` (linear interpolation between CO2 points) and compare the journal: with
`useJournal = true` the engine records `epochSecond,power,valve:position,...` on every change,
entries joined by `;`. The journal is a test aid: it grows until `clearJournal()`.

## Staying standalone

- `package.json` has no `dependencies`; Vitest and TypeScript are dev-only.
- `tsconfig.json` sets `"types": []`, so Node and DOM globals do not type-check.
- Oxlint (`oxlint.config.ts` in the repo root) rejects any non-relative import in `src/` and any
  import that leaves the package; tests may import Vitest as well.
