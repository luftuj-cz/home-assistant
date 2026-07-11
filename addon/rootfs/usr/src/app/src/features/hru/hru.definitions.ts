export const ALLOWED_FUNCTIONS = [
  "bit_and",
  "bit_or",
  "bit_lshift",
  "bit_rshift",
  "non_zero",
  "delay",
  "modbus_write_holding",
  "modbus_write_holding_multi",
  "modbus_read_holding",
  "modbus_read_input",
  "modbus_write_coil",
  "modbus_read_discrete",
  "modbus_read_coil",
  "round",
  "multiply",
  "sum",
  "subtract",
  "clamp",
  "int16",
  "uint16",
] as const;

export type AllowedFunction = (typeof ALLOWED_FUNCTIONS)[number];

export type CommandValue = number | string | CommandExpression;

export interface CommandExpression {
  function: AllowedFunction;
  args: CommandValue[];
}

export type CommandStatement =
  | { type: "assignment"; variable: string; value: CommandValue }
  | { type: "action"; expression: CommandExpression };

export type CommandScript = CommandStatement[];

export type LocalizedText = string | { text: string; translate: boolean };

export type VariableClass = "power" | "temperature" | "mode" | "other";

export interface HruVariable {
  name: string;
  type: "number" | "select" | "boolean";
  editable: boolean;
  onDashboard?: boolean;
  label: LocalizedText;
  unit?: LocalizedText;
  class?: VariableClass;
  min?: number;
  max?: number;
  maxDefault?: number;
  step?: number;
  options?: Array<{
    value: number;
    label: LocalizedText;
  }>;
  maxConfigurable?: boolean;
}

export interface HeatRecoveryUnit {
  code: string;
  name: string;
  variables: HruVariable[];
  "interface-type": "modbus-tcp" | "demo";
  /**
   * Minimum spacing (ms) the unit's Modbus documentation requires between
   * request batches/sessions. Not every unit needs this - e.g. Atrea aM/RD5
   * documentation asks for 5000ms between batches, while Xvent XCONT-CENTRAL
   * only needs frame-end spacing (a few ms) and others specify none at all.
   * Defaults to 0 (no extra spacing) when omitted.
   */
  modbusMinGapMs?: number;
  integration: {
    read: CommandScript;
    write: CommandScript;
    keepAlive?: {
      period: number;
      commands: CommandScript;
    };
  };
}
