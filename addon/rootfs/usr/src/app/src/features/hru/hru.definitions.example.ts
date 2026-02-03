/**
 * This file provides examples of how to define new Regulation Strategies and Heat Recovery Units
 * using the new Command DSL system.
 *
 * You can copy these examples into your main `hru.definitions.ts` or imports them from there.
 */

import type { HeatRecoveryUnit, RegulationStrategy } from "./hru.definitions";

// ==========================================
// Example 1: Atrea RD5 Regulation Strategy
// ==========================================

export const AtreaRD5Strategy: RegulationStrategy = {
  id: "atrea-rd5",
  capabilities: {
    hasPowerControl: true,
    hasTemperatureControl: true,
    hasModeControl: true,
  },
  powerCommands: {
    read: [
      {
        type: "assignment",
        variable: "$power",
        value: {
          function: "modbus_read_holding",
          args: [10704, 1],
        },
      },
    ],
    write: [
      {
        type: "action",
        expression: { function: "modbus_write_holding", args: [10700, 0] },
      },
      {
        type: "action",
        expression: { function: "delay", args: [100] },
      },
      {
        type: "action",
        expression: {
          function: "modbus_write_holding",
          args: [10708, "$power"],
        },
      },
    ],
  },
  temperatureCommands: {
    read: [
      {
        type: "assignment",
        variable: "$rawTemp",
        value: { function: "modbus_read_holding", args: [10706, 1] },
      },
      {
        type: "assignment",
        variable: "$temperature",
        value: { function: "multiply", args: ["$rawTemp", 0.1] },
      },
    ],
    write: [
      {
        type: "action",
        expression: { function: "modbus_write_holding", args: [10702, 0] },
      },
      {
        type: "action",
        expression: { function: "delay", args: [100] },
      },
      {
        type: "action",
        expression: {
          function: "modbus_write_holding",
          args: [
            10710,
            {
              function: "round",
              args: [{ function: "multiply", args: ["$temperature", 10] }],
            },
          ],
        },
      },
    ],
  },
  modeCommands: {
    read: [
      {
        type: "assignment",
        variable: "$mode",
        value: {
          function: "modbus_read_holding",
          args: [10705, 1],
        },
      },
    ],
    write: [
      {
        type: "action",
        expression: { function: "modbus_write_holding", args: [10701, 0] },
      },
      {
        type: "action",
        expression: { function: "delay", args: [100] },
      },
      {
        type: "action",
        expression: {
          function: "modbus_write_holding",
          args: [10709, "$mode"],
        },
      },
    ],
    availableModes: {
      0: "Vypnuto",
      2: "Větrání",
      3: "Cirkulace s větráním",
      4: "Cirkulace",
      5: "Noční předchlazení",
      6: "Rozvážení",
      7: "Přetlak",
    },
  },
};

// ==========================================
// Example 2: Additional Regulation Strategies (Placeholders)
// ==========================================

export const AtreaAMStrategy: RegulationStrategy = {
  id: "modbus-atrea-am",

  capabilities: {
    hasPowerControl: true, // Register 1004 (0-100%)
    hasTemperatureControl: true, // Register 1002
    hasModeControl: true, // Register 1001

    powerStep: 1,
    temperatureStep: 0.1,
  },

  powerCommands: {
    read: [
      {
        type: "assignment",
        variable: "$power",
        value: { function: "modbus_read_holding", args: [1004, 1] },
      },
    ],
    write: [
      {
        type: "action",
        expression: { function: "modbus_write_holding", args: [1004, "$power"] },
      },
    ],
  },

  temperatureCommands: {
    read: [
      // Read register 1002. Assuming raw value is used or service layer handles scaling.
      {
        type: "assignment",
        variable: "$temperature",
        value: { function: "modbus_read_holding", args: [1002, 1] },
      },
    ],
    write: [
      {
        type: "action",
        expression: { function: "modbus_write_holding", args: [1002, "$temperature"] },
      },
    ],
  },

  modeCommands: {
    read: [
      {
        type: "assignment",
        variable: "$mode",
        value: { function: "modbus_read_holding", args: [1001, 1] },
      },
    ],
    write: [
      {
        type: "action",
        expression: { function: "modbus_write_holding", args: [1001, "$mode"] },
      },
    ],
    availableModes: {
      0: "Vypnuto",
      2: "Větrání",
      5: "Noční předchlazení",
      6: "Rozvážení",
      7: "Přetlak",
    },
  },
};

export const XVentStrategy: RegulationStrategy = {
  id: "xvent",

  capabilities: {
    hasPowerControl: true, // "Podporuje nastavení výkonu: ANO"
    hasTemperatureControl: false, // "Podporuje nastavení teploty: NE"
    hasModeControl: false, // "Podporuje nastavení režimu: NE"
  },

  powerCommands: {
    // Read Logic: $power = (holding(0x9C40) >> 6) & 0xF
    read: [
      {
        type: "assignment",
        variable: "$power",
        value: {
          function: "bit_and",
          args: [
            {
              function: "bit_rshift",
              args: [{ function: "modbus_read_holding", args: [0x9c40] }, 6],
            },
            0xf,
          ],
        },
      },
    ],

    // Write Logic: write(0x9C40, old_value | ($power << 6))
    write: [
      {
        type: "action",
        expression: {
          function: "modbus_write_holding",
          args: [
            0x9c40,
            {
              function: "bit_or",
              args: [
                // Read current value to preserve other flags (Power On, Boost, etc.)
                { function: "modbus_read_holding", args: [0x9c40] },
                // Shift new power level to position 6-9
                { function: "bit_lshift", args: ["$power", 6] },
              ],
            },
          ],
        },
      },
    ],
  },
};

// ==========================================
// Example 3: Defining HRUs from Screenshot
// ==========================================

export const ExampleUnits: HeatRecoveryUnit[] = [
  // 1. Atrea Duplex ECV RD5 (%) - Max value 100
  {
    name: "Atrea Duplex ECV RD5",
    regulationTypeId: "modbus-atrea-rd5",
    controlUnit: "%",
    maxValue: 100,
    isConfigurable: false,
  },

  // 2. Atrea Duplex ECV RD5.CF (m3/h) - Configurable max value
  {
    name: "Atrea Duplex ECV RD5.CF",
    regulationTypeId: "modbus-atrea-rd5",
    controlUnit: "m3/h",
    maxValue: 380, // User/installer configurable
    isConfigurable: true,
  },

  // 3. DUPLEX Pro-V.AM (%) - Max value 100
  {
    name: "DUPLEX Pro-V.AM",
    regulationTypeId: "modbus-atrea-am",
    controlUnit: "%",
    maxValue: 100,
    isConfigurable: false,
  },

  // 4. DUPLEX Pro-V.AM.CF (m3/h) - Configurable max value
  {
    name: "DUPLEX Pro-V.AM.CF",
    regulationTypeId: "modbus-atrea-am",
    controlUnit: "m3/h",
    maxValue: 380, // User/installer configurable
    isConfigurable: true,
  },

  // 5. XVent (Level) - Max value 7
  {
    name: "XVent",
    regulationTypeId: "xvent",
    controlUnit: "level",
    maxValue: 7,
    isConfigurable: false,
  },
];
