export type AllowedFunction =
  | "bit_and"
  | "bit_or"
  | "bit_lshift"
  | "bit_rshift"
  | "non_zero"
  | "delay"
  | "modbus_write_holding"
  | "modbus_write_holding_multi"
  | "modbus_read_holding"
  | "modbus_read_input"
  | "modbus_write_coil"
  | "round"
  | "multiply"
  | "sum"
  | "clamp";

export type CommandValue = number | string | CommandExpression;

export interface CommandExpression {
  function: AllowedFunction;
  args: CommandValue[];
}

export type CommandStatement =
  | { type: "assignment"; variable: string; value: CommandValue }
  | { type: "action"; expression: CommandExpression };

export type CommandScript = CommandStatement[];

export interface RegulationCapabilities {
  hasPowerControl: boolean;
  hasTemperatureControl: boolean;
  hasModeControl: boolean;

  powerStep?: number;
  powerUnit?: string;
  temperatureStep?: number;
  temperatureUnit?: string;
}

export interface RegulationStrategy {
  id: string;

  capabilities: RegulationCapabilities;

  powerCommands?: {
    read: CommandScript;
    write: CommandScript;
  };

  temperatureCommands?: {
    read: CommandScript;
    write: CommandScript;
  };
  modeCommands?: {
    read: CommandScript;
    write: CommandScript;

    availableModes: Record<number, string>;
  };

  keepAlive?: {
    period: number;
    commands: CommandScript;
  };
}

export type ControlUnit = "%" | "m3/h" | "level";

interface BaseHRU {
  id: string;
  code?: string;
  name: string;
  regulationTypeId: string;
}

export interface PercentageHRU extends BaseHRU {
  controlUnit: "%";
  maxValue: 100;
  isConfigurable: false;
}

export interface VolumetricHRU extends BaseHRU {
  controlUnit: "m3/h";
  maxValue: number;
  isConfigurable: true;
}

export interface LevelHRU extends BaseHRU {
  controlUnit: "level";
  maxValue: number;
  isConfigurable: false;
}

export type HeatRecoveryUnit = PercentageHRU | VolumetricHRU | LevelHRU;
