# LUFTaTOR Algo CO2 simulator

A browser tool for watching the LUFTaTOR Algo CO2 engine (`@luftator/algo-co2`) work. It runs the real
engine against a virtual house: you set who is in which room, and see CO2, valve positions, HRU power
and every decision the engine makes. Use it to understand the algorithm and to tune its parameters.

**It is a developer tool and is never shipped.** It is not part of the add-on image, the frontend
build or the release. The root `tsconfig.json`, `vp build`, `npm run build:addon` and the backend
`npm test` do not pick it up, and it is excluded from the SonarCloud scan. The UI is in Czech, for a
desktop screen only, and keeps nothing between page loads.

## Setup

```bash
# At the repo root: React, Mantine, Vite+ and Zod come from here.
npm install

# In the backend, only needed to run the tests (they use its Vitest).
cd addon/rootfs/usr/src/app && npm install
```

## Commands

Run these in `tools/algo-co2-simulator/`:

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Start the simulator (http://localhost:5173 by default) |
| `npm test`          | Run the tests (core model, scenarios, UI helpers)      |
| `npm run typecheck` | Type-check the simulator                               |
| `npm run build`     | Optional production bundle for local use               |

Tests run with the backend's Vitest, not `vp test`: at the repo root `vp test` fails at startup with
`Cannot find package 'vite'`, because the hoisted `@vitest/mocker` cannot see the `vite` nested in
Vite+. The tests themselves are plain Vitest tests. That is also why they need `npm install` in
`addon/rootfs/usr/src/app`.

## Using it

Pick a house and a scenario, press play, and change anything while it runs.

- **Floor plan:** rooms are green below TH1, orange from TH1 to TH2, red from TH2. Hatched rooms have no
  reading. Each room lists its valves with their position and a word for it (`otevřeno` up to the
  engine's fully open position, `zavřeno` from the fully closed position, `částečně` in between). Click a
  room to select it.
- **Room panel:** people and activity (a manual change holds until the room's next scenario step), the
  real, sensor and filtered CO2, the engine's timers, and a "sensor not working" switch per sensor.
- **HRU panel, chart, decision log:** current power and airflow, CO2 per room over time, and one log entry
  per change the engine makes.
- **Parametry:** every engine parameter and simulation setting. A number typed into a field applies when
  you leave the field or press Enter (so "300" never passes through 3 and 30 on its way in); the stepper
  arrows and the arrow keys apply at once. Changes do not restart the run. "Obnovit výchozí" restores the
  defaults (engine defaults are read from an engine instance, so they never drift from the package).

Changing the house, the scenario or the start time rebuilds the run; so does "Reset".

## The model

The engine is the real package. Everything around it, the air and the valves, is this tool's own model,
because the package has no physics and does not define the valve scale.

**Each step is 1 simulated second:** apply due scenario steps, advance the room air, update sensors whose
interval has elapsed, call `engine.run()` when the engine period has elapsed, then read the new valve
positions and HRU power (they act from the next step).

**Room.** Volume is the plan rectangle's area times the room height. CO2 `C` is in ppm.

- People add CO2 at a rate set by activity.
- Total supply flow is `nominal flow × power / 100`, exhaust equals supply, and the total does not depend on
  the valve positions: closing some valves pushes more air through the others. It is split among the
  supply valves in proportion to their opening, and likewise among the exhaust valves.
- Fresh inflow is the room's supply flow plus infiltration (`ACH × V`). A room with an exhaust surplus also
  draws transfer air from rooms with a supply surplus, at their flow-weighted mean concentration. Outflow
  equals total inflow.
- `V · dC/dt = generation + C_out · fresh + C_transfer · transfer − C · outflow`, advanced by explicit
  Euler. In steady state `C = C_out + G / Q`.
- A sensor reads the room's `C` rounded to whole ppm, plus optional Gaussian noise, and holds the value
  between updates. A broken sensor reads `null`.

**Valve.** Position 0 is fully open and the fully closed position closes it completely. In between, the
opening is `(1 − position / fullyClosed)^k` with `k = ln(share) / ln(0.5)`, where `share` is the flow
at half of the fully closed position. 25 % gives `k = 2`, 50 % is linear. Nobody knows the real curve of a
LUFTaTOR valve, so it is a setting.

| Constant                    | Default           | Where it is set                      |
| --------------------------- | ----------------- | ------------------------------------ |
| CO2 per person, sleeping    | 13 l/h            | Parametry, `src/core/settings.ts`    |
| CO2 per person, sitting     | 19 l/h            | same                                 |
| CO2 per person, active      | 30 l/h            | same                                 |
| Outdoor CO2                 | 420 ppm           | same                                 |
| Infiltration                | 0.1 ACH (1/h)     | same                                 |
| Valve fully closed position | 90                | same                                 |
| Flow at half-closed         | 25 %              | same                                 |
| Engine period               | 1 s               | same                                 |
| Sensor interval             | 30 s              | same                                 |
| Sensor noise                | off, σ = 15 ppm   | same                                 |
| Room height                 | 2.6 m             | house file, default in `settings.ts` |
| Initial CO2 of a room       | 500 ppm           | scenario, default in `settings.ts`   |
| Speeds                      | ×1, ×60, ×600     | `src/ui/runLoop.ts`                  |
| Chart history               | every 10 s, 24 h  | `src/core/settings.ts`               |
| Decision log                | last 1000 entries | `src/core/settings.ts`               |

The model's tests hold it to these checks: a 36 m³ bedroom with two people asleep and no mechanical
ventilation (infiltration 0.1 ACH) goes from 420 to 1200 ppm in 1.1 to 1.2 h, and settles at about 1290 ppm with 30 m³/h of fresh air.

## Houses

A house is a JSON file in `houses/`, validated with Zod when the app loads. A bad file fails with a message
naming the field; an unknown key counts as a bad field, so a typo in an optional one is not ignored.

| Field                 | Meaning                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `name`                | Display name                                                                                  |
| `hru.nominalFlowM3h`  | Airflow at 100 % power, in m³/h                                                               |
| `hru.initialPowerPct` | Start power in %, or `null` for the engine's `hruMinPower`                                    |
| `rooms[]`             | `id`, `name`, `rect` (`x`, `y`, `w`, `d` in metres), `heightM` (default 2.6), `sensors` (ids) |
| `boxes[].valves[]`    | `id`, `room` (a room id), `type` (`supply` or `exhaust`), `defaultPosition`                   |
| `scenarios[]`         | `id`, `name`, `initialCo2Ppm` (per room, default 500), `steps`                                |
| `scenarios[].steps[]` | `at` (`"HH:MM"`), `room`, `people`, `activity` (`sleeping`, `sitting`, `active`)              |

Ids must be unique, and every `room` and `initialCo2Ppm` key must name an existing room. A room without
sensors never drives a decision; a room without valves only gets infiltration. Scenario steps repeat daily:
a room's occupancy is its latest step at or before the time of day, wrapping across midnight.

A minimal house:

```json
{
  "name": "Garsonka",
  "hru": { "nominalFlowM3h": 150, "initialPowerPct": null },
  "rooms": [
    {
      "id": "pokoj",
      "name": "Pokoj",
      "rect": { "x": 0, "y": 0, "w": 4, "d": 3.5 },
      "sensors": ["sensor_pokoj"]
    },
    {
      "id": "koupelna",
      "name": "Koupelna",
      "rect": { "x": 4, "y": 0, "w": 2, "d": 3.5 },
      "sensors": []
    }
  ],
  "boxes": [
    {
      "id": "box",
      "valves": [
        { "id": "pokoj_privod", "room": "pokoj", "type": "supply", "defaultPosition": 0 },
        { "id": "koupelna_odtah", "room": "koupelna", "type": "exhaust", "defaultPosition": 0 }
      ]
    }
  ],
  "scenarios": [
    {
      "id": "vecer",
      "name": "Večer",
      "initialCo2Ppm": { "pokoj": 600 },
      "steps": [
        { "at": "18:00", "room": "pokoj", "people": 2, "activity": "sitting" },
        { "at": "23:00", "room": "pokoj", "people": 2, "activity": "sleeping" }
      ]
    }
  ]
}
```

**To add a house:** save the file in `houses/` and register it in `src/core/presets.ts`: import the JSON
and add `parseHouse("<id>", <import>)` to `PRESET_HOUSES`. The `<id>` is what the app calls the house
internally; the first house of the list opens first.
