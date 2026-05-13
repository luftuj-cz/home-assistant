export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}
