// ==========================================
// Part 1: Command DSL Representation
// ==========================================
// This section defines the structure for the scripting language.
// Instead of raw strings, commands are parsed into a structured tree.

/**
 * List of allowed functions based on the provided function definition image.
 */
export type AllowedFunction =
  | "bit_and"
  | "bit_or"
  | "bit_lshift"
  | "bit_rshift"
  | "delay"
  | "modbus_write_holding"
  | "modbus_read_holding"
  | "modbus_read_input"
  | "round"
  | "multiply"
  | "divide";

/**
 * A value in a command can be:
 * - A literal number (e.g., 100, 0xF)
 * - A string representing a variable (e.g., '$power') or hex value
 * - The result of another function call (nested expression)
 */
export type CommandValue = number | string | CommandExpression;

/**
 * Represents a function call within a command.
 * e.g., modbus_read_holding(10704)
 */
export interface CommandExpression {
  function: AllowedFunction;
  args: CommandValue[];
}

/**
 * A single execution step in a command script.
 * It can be an assignment to a variable or a standalone action.
 */
export type CommandStatement =
  | { type: "assignment"; variable: string; value: CommandValue } // e.g., $power = ...
  | { type: "action"; expression: CommandExpression }; // e.g., modbus_write_holding(...)

/**
 * A complete command is a sequence of statements executed in order.
 * e.g., "write to reg A; delay; write to reg B"
 */
export type CommandScript = CommandStatement[];

// ==========================================
// Part 2: Regulation Protocol Definition
// ==========================================
// This section defines the logic for communicating with different unit types.

/**
 * Defines what features a regulation protocol supports.
 * Based on the "ANO/NE" columns in the regulation sheets.
 */
export interface RegulationCapabilities {
  hasPowerControl: boolean; // 'Podporuje nastavení výkonu'
  hasTemperatureControl: boolean; // 'Podporuje nastavení teploty'
  hasModeControl: boolean; // 'Podporuje nastavení režimu'

  powerStep?: number; // Step for power adjustment (e.g., 1, 5, 10)
  powerUnit?: string; // Unit for power (e.g., %, m3/h)
  temperatureStep?: number; // Step for temperature adjustment (e.g., 0.1, 0.5, 1)
  temperatureUnit?: string; // Unit for temperature (e.g., °C, °F)
}

/**
 * The complete definition of a regulation protocol.
 * Command groups are optional and should only be present if the corresponding
 * capability is true.
 */
export interface RegulationStrategy {
  id: string; // The unique ID, e.g., 'modbus-atrea-rd5', 'xvent'

  capabilities: RegulationCapabilities;

  // --- Command Groups ---

  // Present if hasPowerControl is true
  powerCommands?: {
    read: CommandScript; // 'Čtení výkonu'
    write: CommandScript; // 'Zápis výkonu'
  };

  // Present if hasTemperatureControl is true
  temperatureCommands?: {
    read: CommandScript; // 'Čtení teploty'
    write: CommandScript; // 'Zápis teploty'
  };

  // Present if hasModeControl is true
  modeCommands?: {
    read: CommandScript; // 'Čtení režimu'
    write: CommandScript; // 'Zápis režimu'

    // A map of mode IDs to their display labels.
    // e.g., { 0: 'Vypnuto', 2: 'Větrání' }
    availableModes: Record<number, string>;
  };
}

// ==========================================
// Part 3: Heat Recovery Unit (HRU) Definition
// ==========================================
// This section defines the physical units from the main list.

/**
 * The unit type used for controlling the device's power.
 */
export type ControlUnit = "%" | "m3/h" | "level";

/**
 * Base properties shared by all HRU models.
 */
interface BaseHRU {
  code?: string; // 'kód'
  name: string; // 'Název'
  regulationTypeId: string; // References RegulationStrategy.id (e.g. 'modbus-atrea-rd5')
}

/**
 * Variant 1: Percentage Controlled Units
 * The maximum value is fixed at 100%.
 */
export interface PercentageHRU extends BaseHRU {
  controlUnit: "%";
  maxValue: 100;
  isConfigurable: false;
}

/**
 * Variant 2: Volumetric (Airflow) Controlled Units
 * The maximum value is specific to the installation and must be configured.
 */
export interface VolumetricHRU extends BaseHRU {
  controlUnit: "m3/h";
  maxValue: number; // e.g., 380, as set by the user/installer
  isConfigurable: true;
}

/**
 * Variant 3: Step/Level Controlled Units
 * The maximum value is a fixed number of levels (e.g., 7).
 */
export interface LevelHRU extends BaseHRU {
  controlUnit: "level";
  maxValue: number; // e.g., 7
  isConfigurable: false;
}

/**
 * The primary type representing any Heat Recovery Unit.
 * It is a discriminated union, where 'controlUnit' determines the specific type.
 */
export type HeatRecoveryUnit = PercentageHRU | VolumetricHRU | LevelHRU;

// Static definitions removed in favor of JSON configuration files loaded by HruLoader.
