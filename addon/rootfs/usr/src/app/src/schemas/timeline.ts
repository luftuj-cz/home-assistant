import { z } from "zod";

// Timeline Mode Schemas
export const timelineModeInputSchema = z.object({
  name: z.string().trim().min(1, "Mode name is required"),
  color: z.string().optional(),
  power: z.number().min(0, "Power must be at least 0").optional(),
  temperature: z.number().min(-50).max(100).optional(),
  luftatorConfig: z
    .record(z.string(), z.number().min(0, "Valve opening must be at least 0"))
    .optional(),
  isBoost: z.boolean().optional(),
  nativeMode: z.number().int().optional(),
});

export const timelineModeUpdateSchema = timelineModeInputSchema;

// Timeline Event Schemas
const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;

export const timelineEventInputSchema = z.object({
  id: z.number().int().positive().optional(),
  startTime: z.string().regex(timeRegex, "Start time must be in HH:MM format"),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  hruConfig: z
    .object({
      mode: z.string().optional(),
      power: z.number().min(0, "Power must be at least 0").optional(),
      temperature: z.number().min(-50).max(100).optional(),
    })
    .nullable()
    .optional(),
  luftatorConfig: z
    .record(z.string(), z.number().min(0, "Valve opening must be at least 0"))
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

// Boost Override Schemas
export const boostOverrideInputSchema = z.object({
  modeId: z.number().int().positive("Mode ID is required"),
  durationMinutes: z.number().int().positive("Duration must be greater than 0"),
});

// Type exports
export type TimelineModeInput = z.infer<typeof timelineModeInputSchema>;
export type TimelineEventInput = z.infer<typeof timelineEventInputSchema>;
export type BoostOverrideInput = z.infer<typeof boostOverrideInputSchema>;

export const testOverrideInputSchema = z.object({
  durationMinutes: z.number().int().positive().default(1),
  config: timelineModeInputSchema,
});
export type TestOverrideInput = z.infer<typeof testOverrideInputSchema>;
