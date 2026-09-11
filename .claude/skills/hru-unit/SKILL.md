---
name: hru-unit
description: >
  Adds support for a new HRU (heat recovery unit) to LUFTaTOR from vendor Modbus documentation
  (PDF, Excel, or text). Extracts the registers for power, requested temperature, ventilation mode
  and inside/outside temperature, then writes both the unit definition JSON in
  addon/rootfs/usr/src/app/src/features/hru/definitions/units/ and a matching Go Modbus simulator in
  tools/simulator/. Activate on "add support for <brand> HRU", "new HRU unit", "implement HRU
  definition", "write a simulator for <brand>", or when given HRU Modbus documentation to integrate.
---

# Adding a new HRU unit to LUFTaTOR

## What you produce

Two artifacts, always written together:

| Artifact         | Path                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| Unit definition  | `addon/rootfs/usr/src/app/src/features/hru/definitions/units/<code>.json`        |
| Modbus simulator | `tools/simulator/<code>.go` + a `case` arm in `tools/simulator/hru_simulator.go` |

Plus any new i18n keys in `src/shared/i18n/locales/{en,cs}/common.json`.

They are written together on purpose: the simulator is the executable statement of what the JSON expects.
If the JSON reads holding register 1002 and the simulator does not serve 1002, one of the two is wrong and
you find out in seconds instead of against real hardware.

There are **no automated tests** in this repo, and the definition loader fails silently — a malformed JSON is
logged once and the unit just disappears from the API. So the contract below has to be followed exactly.

## Step 1 — Read the vendor documentation

- **PDF** — use the `Read` tool with `pages` (native PDF support). If register tables come out scrambled,
  fall back to `pdftotext -layout doc.pdf -`.
- **Excel** — `libreoffice --headless --convert-to csv --outdir /tmp/hru doc.xlsx`. This converts the
  **first sheet only**; if the register map is spread over several sheets, re-export per sheet.
  `ssconvert`, `in2csv` and Python's `openpyxl` are not installed here.
- **Text / HTML** — read directly.

## Step 2 — Fill the register map before writing any code

Complete this table from the documentation. Do not start coding until it is filled in.

| Quantity              | R/W | Modbus FC | Address (dec / hex) | Raw → engineering | Signed? | Range | Notes                                 |
| --------------------- | --- | --------- | ------------------- | ----------------- | ------- | ----- | ------------------------------------- |
| power                 |     |           |                     |                   |         |       | required                              |
| requested temperature |     |           |                     |                   |         |       | if supported                          |
| ventilation mode      |     |           |                     |                   |         |       | if supported, list every option value |
| inside temperature    |     |           |                     |                   |         |       | if supported, read-only               |
| outside temperature   |     |           |                     |                   |         |       | if supported, read-only               |

Add rows for anything else worth showing (supply/exhaust temperature, humidity, filter countdown, error flag,
serial number) and for any **write handshake** the document describes — an unlock register, an edit-mode
register, a commit register, or a keep-alive coil. Those change the shape of both artifacts.

Rules for this step:

- **Power is mandatory.** Everything else is optional — if the documentation does not describe it, leave it out.
  Never invent a register address or a scaling factor to fill a gap.
- Record the Modbus function code explicitly. Holding (FC3/FC6) and input (FC4) registers are separate address
  spaces, and vendors routinely document the same number in both.
- Record whether the address in the document is 0-based (protocol) or 1-based (documentation convention). Getting
  this wrong shifts every register by one and is the single most common mistake.
- Record signedness. Temperatures below zero are two's complement and need `int16` in the JSON.
- If a quantity is a bit inside a packed register, note the shift and mask, not just the register number.

## Step 3 — Write the JSON definition

Read `references/definition-schema.md` for the full contract. In brief:

```json
{
  "code": "<kebab-case, unique, == filename>",
  "name": "<display name>",
  "variables": [ ... ],
  "interface-type": "modbus-tcp",
  "integration": { "read": [ ... ], "write": [ ... ] }
}
```

- One variable per quantity from the register map.
- Exactly one variable with `"class": "power"`; at most one with `"class": "mode"` (both are looked up with
  `.find`, so a second one is unreachable).
- Requested temperature is an ordinary variable: `"editable": true`, `"class": "temperature"`, conventionally
  `"name": "temperature"`.
- Inside/outside temperature are `"editable": false`, `"class": "temperature"`, `"onDashboard": true`. There is
  no inside/outside semantic in the code — the distinction is carried entirely by the `label`, so use the
  existing keys `hru.roomTemperature` and `hru.outsideTemperature`.
- The `read` script must assign `$<name>` for **every** declared variable. An unassigned variable silently
  reads as `0`.
- The `write` script must consume `$<name>` for every `"editable": true` variable.
- Only the 20 functions in `ALLOWED_FUNCTIONS` may appear, at any nesting depth. Anything else makes the loader
  throw and drops the whole unit.

## Step 4 — Write the Go simulator

Read `references/simulator-template.md` for the skeleton, the seven helper signatures, and the protocol idioms.
In brief: a state struct, a `New<Name>()` constructor with realistic power-on defaults, and
`Configure(serv *Server)` registering one closure per Modbus function code the unit supports — plus
`&IllegalFunction` stubs for every function code it does not. Then add the `case` arm to the switch in
`tools/simulator/hru_simulator.go`.

Implement exactly the addresses the JSON references, and nothing else. The simulator is not a general-purpose
device model; it is a fixture for this definition.

## Step 5 — i18n keys

Every `{ "text": "hru.xxx", "translate": true }` label, unit and option label needs a key in **both**
`src/shared/i18n/locales/en/common.json` and `src/shared/i18n/locales/cs/common.json`, under the `hru` object.
`scripts/copy-translations.mjs` mirrors these into `addon/rootfs/usr/src/app/src/locales/` at build time, so
the backend and MQTT discovery see them too.

Reuse these before inventing new ones:

```
hru.power  hru.temperature  hru.mode  hru.nativeMode  hru.level  hru.bypass  hru.boost
hru.offset  hru.flowIn  hru.flowOut  hru.serialNo  hru.errorState
hru.changeFilters  hru.changeFiltersIn  hru.days
hru.roomTemperature  hru.roomHumidity  hru.outsideTemperature  hru.supplyTemperature
hru.temperatureProfile
hru.modes.off  hru.modes.ventilation  hru.modes.circulation
hru.modes.circulationWithVentilation  hru.modes.bypass  hru.modes.disbalance  hru.modes.overpressure
```

Mode option labels should use the `hru.modes.<key>` form — `getModeLabels()` in
`addon/rootfs/usr/src/app/src/services/mqttService.ts` only translates keys of exactly that shape when
publishing Home Assistant MQTT discovery.

A plain-string label needs no key: a bare string is tried as a translation key and falls back to itself, which
is why literals like `"Te1"`, `"%"`, `"˚C"` and `"Normal"` work as-is.

## Verification checklist

Definitions are loaded **once**, in the `HruService` constructor — there is no hot reload. Restart the backend
after every JSON edit.

1. **Simulator builds and runs.**
   ```bash
   cd tools/simulator && go build luftuj-cz/hru-simulator && ./hru-simulator 5502 <code>
   ```
   Port is a mandatory positional argument and binds `0.0.0.0`. Use a high port — 502 needs root.
2. **Definition loads.** Restart the backend (`cd addon/rootfs/usr/src/app && npm run dev`). The startup log
   line `"Loaded heat recovery units"` shows a count one higher than before, and there is **no**
   `"Failed to load unit from file"` error. That error means the unit was dropped entirely.
3. **Unit is exposed.** `GET /api/hru/units` lists the new `code` and `name`.
4. **Modes resolve.** `GET /api/hru/modes?unitId=<code>` returns one entry per option.
5. **Reads work.** Point the addon at the simulator via `POST /api/settings/hru`
   (`{unit, host, port, unitId}` — host `127.0.0.1`, the port from step 1, unitId `1`), then `GET /api/hru/read`.
   Check both `values` (numbers) and `displayValues` (resolved labels). A value of exactly `0` where you expect
   a reading usually means the `read` script never assigned that `$variable`.
6. **Writes work.** `POST /api/hru/write` with a payload of editable variable names. The simulator prints
   `>>> CHANGE: ...` for each accepted write. Nothing printed means the address or the handshake is wrong.
7. **Inspect planned writes.** `logPlannedWrites` in `hru.service.ts` logs `{fn, address, args}` for every
   `modbus_write_*` before it goes out — the fastest way to spot a wrong address or an unscaled value.
8. **Dashboard.** Confirm the power ring, the temperature tiles and the mode selector render, and that
   every variable you meant to show has `"onDashboard": true` (the filter is `=== true`, not truthy).

## Common mistakes

All of these are silent — nothing errors, the value is just wrong.

- A variable declared but never assigned by `read` reads as `0` (`rawValues["$" + name] ?? 0`).
- A `$var` used in `write` but absent from the request payload resolves to `0` and gets **written** as `0`.
- `code` uniqueness is not checked across files, and `getUnitById` matches on `code` **or** `name` — a collision
  silently shadows another unit.
- `"maxConfigurable": true` without `"maxDefault"` makes `POST /api/settings/hru` fail with `MAX_POWER_REQUIRED`.
- `"editable": true` with `"type": "select"` and no non-empty `options` throws in the loader — the whole unit is
  dropped.
- Omitting `integration` on a `modbus-tcp` unit throws inside the loader's `try` — the unit vanishes from the API.
  (`demo.json` omits it legitimately because `"interface-type": "demo"` short-circuits validation.)
- Do not invent `class` values. `"humidity"` in `zehnder.json` is inert and falls through to the generic tile.
- Do not add `defaultValue`. It appears in `meltem.json` and is read by nothing.
- Arguments of one expression are evaluated **in parallel**. A `delay` nested as a sibling argument orders
  nothing — use separate top-level `action` statements when sequence matters.
