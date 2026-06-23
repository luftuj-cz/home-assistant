import { z } from "zod";

export const seasonalModeInputSchema = z.object({
  baseModeId: z.number().int().positive(),
  power: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  variables: z
    .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
    .nullable()
    .optional(),
  luftatorConfig: z.record(z.string(), z.number()).nullable().optional(),
  enabled: z.boolean(),
});

export type SeasonalModeInput = z.infer<typeof seasonalModeInputSchema>;
