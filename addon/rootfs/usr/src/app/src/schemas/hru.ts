import { z } from "zod";

// HRU Write Schema
export const hruWriteInputSchema = z
  .object({
    power: z.number().min(0).max(100).optional(),
    temperature: z.number().min(-50).max(100).optional(),
    mode: z.union([z.number().int(), z.string()]).optional(),
  })
  .refine(
    (data) => data.power !== undefined || data.temperature !== undefined || data.mode !== undefined,
    {
      message: "At least one of power, temperature, or mode must be provided",
    },
  );

// Type exports
export type HruWriteInput = z.infer<typeof hruWriteInputSchema>;
