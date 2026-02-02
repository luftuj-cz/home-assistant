export type RegisterKind = "holding" | "input";

export interface HruRegister {
  address: number;
  kind: RegisterKind; // register type
  scale?: number; // multiply raw value by scale (e.g., 0.1)
  precision?: number; // client hint
  unit?: string; // client hint
}

export interface HruEnumRegister extends HruRegister {
  values: Record<number, string>;
}

export interface HruWriteStep {
  address: number;
  kind: RegisterKind;
  value: number | ((input: number) => number);
  delayMs?: number;
}

export interface HruWriteDefinition {
  steps: HruWriteStep[];
}

export interface HruUnitDefinition {
  id: string;
  name: string;
  description?: string;
  capabilities?: {
    supportsPowerWrite?: boolean;
    supportsTemperatureWrite?: boolean;
    supportsModeWrite?: boolean;
  };
  registers: {
    read: {
      power: HruRegister; // %
      temperature: HruRegister; // °C
      mode: HruEnumRegister; // enumerated modes
    };
    write?: {
      power?: HruWriteDefinition;
      temperature?: HruWriteDefinition;
      mode?: HruWriteDefinition;
    };
  };
}

export const HRU_UNITS: HruUnitDefinition[] = [
  {
    id: "atrea-rd5",
    name: "Atrea RD5",
    description: "Atrea RD5 heat recovery unit controlled over Modbus TCP",
    capabilities: {
      supportsPowerWrite: true,
      supportsTemperatureWrite: true,
      supportsModeWrite: true,
    },
    registers: {
      read: {
        power: {
          address: 10704,
          kind: "holding",
          unit: "%",
        },
        temperature: {
          address: 10706,
          kind: "holding",
          scale: 0.1,
          precision: 1,
          unit: "°C",
        },
        mode: {
          address: 10705,
          kind: "holding",
          values: {
            0: "Vypnuto",
            2: "Větrání",
            5: "Noční předchlazení",
            6: "Rozvážení",
            7: "Přetlak",
          },
        },
      },
      write: {
        power: {
          steps: [
            { address: 10700, kind: "holding", value: 0 },
            { address: 10708, kind: "holding", value: (input) => Math.round(input), delayMs: 100 },
          ],
        },
        temperature: {
          steps: [
            { address: 10702, kind: "holding", value: 0 },
            {
              address: 10710,
              kind: "holding",
              value: (input) => Math.round(input * 10),
              delayMs: 100,
            },
          ],
        },
        mode: {
          steps: [
            { address: 10701, kind: "holding", value: 0 },
            { address: 10709, kind: "holding", value: (input) => Math.round(input), delayMs: 100 },
          ],
        },
      },
    },
  },
];

export function getUnitById(id: string): HruUnitDefinition | undefined {
  return HRU_UNITS.find((u) => u.id === id);
}
