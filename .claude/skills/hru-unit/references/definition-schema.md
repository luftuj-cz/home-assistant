# HRU unit definition — full contract

Source of truth: `addon/rootfs/usr/src/app/src/features/hru/hru.definitions.ts` (types + allowed functions),
`hru.loader.ts` (validation), `hru.repository.ts` (runtime semantics), `hru.service.ts` (API mapping).

Definitions live in `addon/rootfs/usr/src/app/src/features/hru/definitions/units/`. Any `*.json` there is picked
up by `readdirSync` — there is no index, no import list, no registration step. The filename is irrelevant to
identity (`code` is the identity), but by convention the file is named `<code>.json`.

There is **no Zod schema** for unit definitions. The JSON is `JSON.parse(...) as HeatRecoveryUnit` — an unchecked
cast. Unknown fields pass straight through to the frontend; missing required fields blow up at use site.

## Types (verbatim)

```ts
export type LocalizedText = string | { text: string; translate: boolean };

export interface HruVariable {
  name: string;
  type: "number" | "select" | "boolean";
  editable: boolean;
  onDashboard?: boolean;
  label: LocalizedText;
  unit?: LocalizedText;
  class?: "power" | "temperature" | "mode" | "other";
  min?: number;
  max?: number;
  maxDefault?: number;
  step?: number;
  options?: Array<{ value: number; label: LocalizedText }>;
  maxConfigurable?: boolean;
}

export interface HeatRecoveryUnit {
  code: string;
  name: string;
  variables: HruVariable[];
  "interface-type": "modbus-tcp" | "demo";
  integration: {
    read: CommandScript;
    write: CommandScript;
    keepAlive?: { period: number; commands: CommandScript };
  };
}

export type CommandStatement =
  | { type: "assignment"; variable: string; value: CommandValue }
  | { type: "action"; expression: CommandExpression };

export type CommandValue = number | string | CommandExpression;
export interface CommandExpression {
  function: AllowedFunction;
  args: CommandValue[];
}
```

Note the hyphen in `"interface-type"`. Use `"modbus-tcp"` — there is **no RTU/serial path** anywhere in the
backend (`shared/modbus/client.ts` only ever calls `connectTCP`).

### Fields used in real definitions but absent from the TS type

These are legitimate — the cast lets them through and the frontend consumes them:

| Field                              | Used by                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `"class": "flag"`                  | `HruStatusCard.renderFlags` — coloured status dots                |
| `"flag": "positive" \| "negative"` | colour of the dot: active+negative → red, active+positive → green |

`"class": "humidity"` (zehnder) and `"defaultValue"` (meltem) are **inert** — nothing reads them. Don't copy them.

## The value grammar

Inside `value` and `args`:

| Form                                 | Meaning                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `123`                                | literal number                                                              |
| `"$power"`                           | variable reference. **The `$` is part of the stored key.** Unassigned → `0` |
| `"0x9C40"`                           | hex literal. Prefix match is case-sensitive on lowercase `0x`               |
| `"42"`                               | numeric string → `42`; a non-numeric string → `0`                           |
| `{ "function": ..., "args": [...] }` | nested expression                                                           |

## All 20 allowed functions

Anything not in this list makes `HruLoader.validateExpression` throw and the entire unit is dropped.

### Modbus

| Function                     | Modbus FC | Semantics                                         |
| ---------------------------- | --------- | ------------------------------------------------- |
| `modbus_read_holding`        | **3**     | `args: [addr, count=1]` → returns `data[0]` only  |
| `modbus_read_input`          | **4**     | `args: [addr, count=1]` → returns `data[0]` only  |
| `modbus_read_discrete`       | **2**     | `args: [addr, count=1]` → `1` or `0`              |
| `modbus_read_coil`           | **1**     | `args: [addr, count=1]` → `1` or `0`              |
| `modbus_write_holding`       | **6**     | `args: [addr, val]` → returns `val`               |
| `modbus_write_holding_multi` | **16**    | `args: [addr, v1, v2, ...]` — variadic value list |
| `modbus_write_coil`          | **5**     | `args: [addr, val]` — any non-zero ⇒ ON           |

All reads return **only the first register**, whatever `count` says. There is no 32-bit, float, string or
word-swap support: anything wider than one 16-bit register must be assembled by hand with `bit_lshift` + `sum`.

### Arithmetic and bit manipulation

| Function     | Semantics                                                                            |
| ------------ | ------------------------------------------------------------------------------------ |
| `bit_and`    | `a & b`                                                                              |
| `bit_or`     | `a \| b`                                                                             |
| `bit_lshift` | `a << b`                                                                             |
| `bit_rshift` | `a >> b` — **arithmetic** (sign-propagating), not `>>>`                              |
| `non_zero`   | `a === 0 ? 0 : 1` — boolean-ise a masked bit                                         |
| `round`      | `Math.round(a)`                                                                      |
| `sum`        | variadic `a + b + ...`                                                               |
| `multiply`   | variadic `a * b * ...`                                                               |
| `subtract`   | `a - b`                                                                              |
| `clamp`      | `args: [a, min=0, max=100]`                                                          |
| `int16`      | reinterpret a raw register as signed 16-bit — **required for negative temperatures** |
| `uint16`     | reinterpret as unsigned 16-bit                                                       |
| `delay`      | `args: [ms]`, returns `0`. Only meaningful as a top-level `action`                   |

## Execution semantics

- Statements run **strictly sequentially**, top to bottom.
- **Arguments of one expression are evaluated in parallel** (`Promise.all(args.map(evaluate))`). A `delay` nested
  as a sibling argument therefore orders nothing. When sequence matters — unlock, then write — use separate
  top-level `action` statements.
- One script execution = one shared cached Modbus TCP client; operations are serialised on a lock inside the
  client, and a dead socket is retried exactly once.
- `read` fills a variable map; `hru.service.ts` then reads `rawValues["$" + variable.name]` for each declared
  variable, defaulting to `0`.
- `write` receives the request payload pre-loaded as `initialVariables`, keyed `$<name>`, already validated and
  normalised (booleans → `1`/`0`, select labels → numeric option values, numbers range-checked).

## Variable class → UI contract

From `src/features/dashboard/components/HruStatusCard.tsx` and
`addon/rootfs/usr/src/app/src/services/mqttService.ts`.

Only variables with `"onDashboard": true` (literal `true` — the filter is `=== true`) appear on the dashboard or
get an MQTT entity. `"editable": true` variables appear in the timeline/boost editor regardless of `onDashboard`.

| class             | Renders as                                 | Required fields                                                                | MQTT                                                          |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `power`           | ring gauge, green / orange >40% / red >70% | `max`, **or** `maxConfigurable: true` + `maxDefault`. `unit` defaults to `"%"` | `device_class: power_factor` when unit is `%`, icon `mdi:fan` |
| `temperature`     | temperature tile, `toFixed(1)`             | `label`, `unit` (defaults `"°C"`)                                              | `device_class: temperature`, icon `mdi:thermometer`           |
| `mode`            | select                                     | `type: "select"` + non-empty `options`                                         | icon `mdi:cog`                                                |
| `flag`            | coloured dot                               | `type: "boolean"` + `flag: "positive"\|"negative"`                             | icon `mdi:eye`                                                |
| `other` / omitted | generic tile                               | —                                                                              | icon `mdi:eye`                                                |

### Inside vs outside temperature

**There is no inside/outside semantic anywhere in the code.** Every `class: "temperature"` variable renders
identically; the distinction is carried purely by the `label`. Use the existing keys so both the UI and Home
Assistant name them correctly:

```json
{ "name": "roomTemperature",    "type": "number", "editable": false, "onDashboard": true,
  "label": { "text": "hru.roomTemperature",    "translate": true }, "unit": "˚C", "class": "temperature" },
{ "name": "outsideTemperature", "type": "number", "editable": false, "onDashboard": true,
  "label": { "text": "hru.outsideTemperature", "translate": true }, "unit": "˚C", "class": "temperature" }
```

Units that expose several raw probes instead of named ones (Korado) use literal labels — `"Te1"`, `"Ti1"` —
which need no translation key.

### Requested temperature

Not a special widget. Model it as an ordinary editable variable, conventionally named `temperature`:

```json
{
  "name": "temperature",
  "type": "number",
  "editable": true,
  "onDashboard": true,
  "label": { "text": "hru.temperature", "translate": true },
  "unit": "˚C",
  "min": 10,
  "max": 30,
  "step": 0.5,
  "class": "temperature"
}
```

`min`/`max` are enforced server-side on write (`normaliseWriteValue`); `step` drives the NumberInput.

### Ventilation mode

`class: "mode"` + `type: "select"` + `options`. This also feeds `GET /api/hru/modes`, which the timeline
scheduler uses, so `value` must be the raw number written to the device:

```json
{
  "name": "mode",
  "type": "select",
  "editable": true,
  "onDashboard": true,
  "label": { "text": "hru.nativeMode", "translate": true },
  "class": "mode",
  "options": [
    { "value": 0, "label": { "text": "hru.modes.off", "translate": true } },
    { "value": 2, "label": { "text": "hru.modes.ventilation", "translate": true } },
    { "value": 5, "label": { "text": "hru.modes.bypass", "translate": true } }
  ]
}
```

Option values need not be contiguous — use the device's actual codes.

### Configurable power maximum

For units whose power is airflow in m³/h and whose ceiling depends on the installation (`atrea-am-cf`):

```json
{
  "name": "power",
  "type": "number",
  "editable": true,
  "onDashboard": true,
  "label": { "text": "hru.power", "translate": true },
  "unit": "m³/h",
  "min": 0,
  "maxDefault": 380,
  "maxConfigurable": true,
  "step": 10,
  "class": "power"
}
```

`getEffectiveMax` resolves to `maxConfigurable ? (settings.maxPower ?? maxDefault ?? max) : max`. With
`maxConfigurable: true`, `maxDefault` is effectively required — otherwise `POST /api/settings/hru` rejects with
`MAX_POWER_REQUIRED` and the write bound is unbounded.

## Worked example — `korado.json` (keep-alive + signed scaling)

```json
{
  "code": "korado",
  "name": "KORADO VENTBOX",
  "variables": [
    {
      "name": "power",
      "type": "number",
      "editable": true,
      "onDashboard": true,
      "label": { "text": "hru.power", "translate": true },
      "unit": "%",
      "min": 0,
      "max": 100,
      "maxConfigurable": false,
      "step": 5,
      "class": "power"
    },
    {
      "name": "unit_sn",
      "type": "number",
      "editable": false,
      "onDashboard": true,
      "label": { "text": "hru.serialNo", "translate": true }
    },
    {
      "name": "te1",
      "type": "number",
      "editable": false,
      "onDashboard": true,
      "label": "Te1",
      "unit": "˚C",
      "class": "temperature"
    }
  ],
  "interface-type": "modbus-tcp",
  "integration": {
    "read": [
      {
        "type": "assignment",
        "variable": "$power",
        "value": { "function": "modbus_read_input", "args": [107, 1] }
      },
      {
        "type": "assignment",
        "variable": "$unit_sn",
        "value": { "function": "modbus_read_input", "args": [100, 1] }
      },
      {
        "type": "assignment",
        "variable": "$te1",
        "value": {
          "function": "multiply",
          "args": [
            {
              "function": "int16",
              "args": [{ "function": "modbus_read_input", "args": [110, 1] }]
            },
            0.1
          ]
        }
      }
    ],
    "write": [
      {
        "type": "action",
        "expression": { "function": "modbus_write_holding", "args": [106, "$power"] }
      }
    ],
    "keepAlive": {
      "period": 5000,
      "commands": [
        { "type": "action", "expression": { "function": "modbus_write_coil", "args": [31, 1] } }
      ]
    }
  }
}
```

`int16(...)` then `multiply(..., 0.1)` is **the** idiom for a signed tenths-of-a-degree temperature. Without
`int16`, a raw `65404` reads as `6540.4 °C` instead of `-13.2 °C`.

`keepAlive.period` is returned by `executeKeepAlive()` so `timelineScheduler.ts` can re-arm the timer. Add it
only when the device has a watchdog that disables writes without a periodic heartbeat.

## Worked example — unlock-then-write (`atrea-rd5.json`)

When the device requires a register to be unlocked before the value register accepts a write, emit separate
top-level actions with `delay` between them — nesting the delay would not order anything:

```json
"write": [
  { "type": "action", "expression": { "function": "modbus_write_holding", "args": [10700, 0] } },
  { "type": "action", "expression": { "function": "delay", "args": [100] } },
  { "type": "action", "expression": { "function": "modbus_write_holding", "args": [10708, "$power"] } },
  { "type": "action", "expression": { "function": "modbus_write_holding", "args": [10702, 0] } },
  { "type": "action", "expression": { "function": "delay", "args": [100] } },
  { "type": "action", "expression": { "function": "modbus_write_holding", "args": [10710,
      { "function": "round", "args": [
        { "function": "multiply", "args": ["$temperature", 10] } ] } ] } }
]
```

Note the write-side scaling mirror: read is `multiply(int16(read), 0.1)`, write is `round(multiply($var, 10))`.

## Worked example — packed bitfield (`xvent.json`)

When several quantities share one register, read it **once** into a scratch variable and decode the fields from
that — not once per field. A scratch variable is any `$name` that no declared variable matches; the service
simply ignores it when building the response.

```json
"read": [
  { "type": "assignment", "variable": "$frontPanel",
    "value": { "function": "modbus_read_holding", "args": ["0x9C40"] } },

  { "type": "assignment", "variable": "$power",
    "value": { "function": "bit_and", "args": [
      { "function": "bit_rshift", "args": ["$frontPanel", 6] },
      "0xF" ] } },

  { "type": "assignment", "variable": "$boost",
    "value": { "function": "non_zero", "args": [
      { "function": "bit_and", "args": ["$frontPanel", "0x10"] } ] } }
]
```

`bit_and` + `bit_rshift` extracts a multi-bit field; `non_zero` turns a single masked bit into `1`/`0` for a
`type: "boolean"` variable.

The write side is read-modify-write: mask off exactly the bits being replaced, OR the new values in, write the
whole word back.

```json
"write": [
  { "type": "assignment", "variable": "$tmpFrontPanel",
    "value": { "function": "bit_and", "args": [
      { "function": "modbus_read_holding", "args": ["0x9C40"] }, "0xFC0B" ] } },
  { "type": "assignment", "variable": "$tmpFrontPanel",
    "value": { "function": "bit_or", "args": [
      "$tmpFrontPanel", { "function": "bit_lshift", "args": ["$power", 6] } ] } },
  { "type": "action",
    "expression": { "function": "modbus_write_holding_multi", "args": ["0x9C40", "$tmpFrontPanel"] } }
]
```

The mask `0xFC0B` clears exactly the bits being replaced and preserves the rest. Each `bit_or` step is a separate
assignment because each one depends on the previous value of `$tmpFrontPanel`.

## What the loader validates — and what it does not

`HruLoader.validateUnit` enforces only:

1. No duplicate `name` among `editable` variables.
2. `editable` + `type: "select"` has a non-empty `options` array.
3. Every `function` in `read`, `write` and `keepAlive.commands`, at any depth, is in `ALLOWED_FUNCTIONS`.

`interface-type: "demo"` returns early and skips 3 entirely (that is how `demo.json` gets away with having no
`integration` key at all).

**Not validated** — each of these fails silently at runtime:

- `code` uniqueness across files.
- Legality of the `interface-type` value (a typo is treated as non-demo, so `integration` becomes required).
- Duplicate names among non-editable variables.
- That the `read` script assigns every declared variable → unassigned reads as `0`.
- That `$variable` names in scripts match declared variables → extra script variables are silently dropped.
- Argument counts or arity of any function.
- `class`, `flag` and `type` enum values.
- Coherence of `min` / `max` / `step`.

A unit that throws during load is logged as `"Failed to load unit from file"` and **skipped** — the rest still
load, so the only symptom is that the unit is missing from `GET /api/hru/units`.

## API surface a definition feeds

| Endpoint                           | What it returns from the definition                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/hru/units`               | `{ id: code, code, name, variables }` — `interface-type` and `integration` are **not** exposed                              |
| `GET /api/hru/modes?unitId=<code>` | `options` of the `class: "mode"` variable, as `{ id: value, name: <raw label text> }` — untranslated, resolved client-side  |
| `GET /api/hru/read`                | `values` (numbers, keyed by `name` without `$`), `displayValues` (booleans / resolved option labels / numbers), `variables` |
| `POST /api/hru/write`              | accepts only `editable: true` names; rejects unknown names with `HRU_INVALID_VARIABLES`                                     |
