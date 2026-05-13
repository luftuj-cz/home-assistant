export interface Valve {
  entityId: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  state: string;
  isAvailable: boolean;
  attributes: Record<string, unknown>;
}
