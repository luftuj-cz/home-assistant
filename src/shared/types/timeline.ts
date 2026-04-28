export interface TimelineEvent {
  id?: number;
  startTime: string;
  dayOfWeek: number;
  hruConfig?: Record<string, unknown> | null;
  luftatorConfig?: Record<string, number> | null;
  enabled: boolean;
}

export interface ApiTimelineEvent {
  id?: number;
  startTime?: string;
  start_time?: string;
  dayOfWeek?: number | null;
  day_of_week?: number | null;
  hruConfig?: Record<string, unknown>;
  hru_config?: Record<string, unknown>;
  luftatorConfig?: Record<string, number>;
  luftator_config?: Record<string, number>;
  enabled?: boolean;
}

export interface Mode {
  id: number;
  name: string;
  color?: string;
  variables?: Record<string, number | string | boolean>;
  luftatorConfig?: Record<string, number>;
  isBoost?: boolean;
  hruId?: string;
  nativeMode?: number;
  power?: number;
  temperature?: number;
}
