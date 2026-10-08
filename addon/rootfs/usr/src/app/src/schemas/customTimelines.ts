import { z } from "zod";

/** Strict HH:MM: the week editor sorts start times as strings. */
const startTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must be in HH:MM format");

export const customTimelineNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(60, "Name must be at most 60 characters");

export const customTimelineCreateInputSchema = z.object({ name: customTimelineNameSchema });

export const customTimelineRenameInputSchema = z.object({ name: customTimelineNameSchema });

/**
 * A custom event references a mode and nothing else. `strict` rejects HRU or
 * valve values: the mode's values always come from the active season.
 */
export const customTimelineEventInputSchema = z
  .object({
    modeId: z.number().int().positive("Mode ID is required"),
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    startTime: startTimeSchema,
    enabled: z.boolean().default(true),
    priority: z.number().int().min(0).max(100).default(0),
  })
  .strict();

export const customTimelineFillInputSchema = z.object({
  modeId: z.number().int().positive("Mode ID is required"),
});

export const customOverrideInputSchema = z
  .object({
    customTimelineId: z.number().int().positive("Custom timeline ID is required"),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt),
    { message: "The override must end after it starts", path: ["endsAt"] },
  );

export type CustomTimelineEventInput = z.infer<typeof customTimelineEventInputSchema>;
export type CustomOverrideInput = z.infer<typeof customOverrideInputSchema>;
