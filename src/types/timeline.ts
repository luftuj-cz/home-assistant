export interface HruCapabilities {
  supportsPowerWrite?: boolean;
  supportsTemperatureWrite?: boolean;
  supportsModeWrite?: boolean;
}

export interface TimelineEvent {
  id?: number;
  startTime: string;
  dayOfWeek: number;
  hruConfig?: { mode?: string; power?: number; temperature?: number } | null;
  hruCapabilities?: HruCapabilities;
  luftatorConfig?: Record<string, number> | null;
  enabled: boolean;
}

export interface ApiTimelineEvent {
  id?: number;
  startTime?: string;
  start_time?: string;
  dayOfWeek?: number | null;
  day_of_week?: number | null;
  hruConfig?: TimelineEvent["hruConfig"];
  hru_config?: TimelineEvent["hruConfig"];
  hruCapabilities?: TimelineEvent["hruCapabilities"];
  hru_capabilities?: TimelineEvent["hruCapabilities"];
  luftatorConfig?: TimelineEvent["luftatorConfig"];
  luftator_config?: TimelineEvent["luftatorConfig"];
  enabled?: boolean;
}

export interface Mode {
  id: number;
  name: string;
  color?: string;
  power?: number;
  temperature?: number;
  luftatorConfig?: Record<string, number>;
  isBoost?: boolean;
  hruId?: string;
}
