export type ConnectionState = "connected" | "connecting" | "disconnected" | "offline";
export type ModbusState = "loading" | "reachable" | "unreachable";
export type MqttState = "connected" | "disconnected" | "loading";

export interface ActiveMode {
  source: "manual" | "schedule" | "boost";
  modeName?: string;
}

export type LocalizedText = string | { text: string; translate: boolean };

export type VariableClass = "power" | "temperature" | "mode" | "flag" | "other";

export type VariableFlag = "positive" | "negative";

export interface HruVariable {
  name: string;
  type: "number" | "select" | "boolean";
  editable: boolean;
  onDashboard?: boolean;
  label: LocalizedText;
  unit?: LocalizedText;
  class?: VariableClass;
  flag?: VariableFlag;
  min?: number;
  max?: number;
  step?: number;
  maxConfigurable?: boolean;
  options?: Array<{
    value: number;
    label: LocalizedText;
  }>;
}

export type HruState =
  | {
      values: Record<string, number | string | boolean>;
      displayValues: Record<string, string | number | boolean>;
      variables: HruVariable[];
      registers?: {
        power?: { unit?: string; scale?: number; precision?: number };
        temperature?: { unit?: string; scale?: number; precision?: number };
      };
    }
  | { error: string }
  | null;
