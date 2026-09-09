import { z } from "zod";

const hruWriteValueSchema = z.union([z.number(), z.string(), z.boolean()]);

// HRU Write Schema
export const hruWriteInputSchema = z
  .looseObject({
    power: z
      .number()
      .min(0, "Power must be at least 0")
      .max(65535, "Power must be at most 65535")
      // Rounded rather than rejected: 1.0.9 accepted any non-negative number
      // and the UI let decimals through, so stored modes and external
      // automations still send e.g. 47.5. Refusing them would lock a mode
      // saved under 1.0.9 until the user retyped a value they never chose.
      .transform((value) => Math.round(value))
      .optional(),
    temperature: z
      .number()
      .min(0, "Temperature must be at least 0")
      .max(50, "Temperature must be at most 50")
      .optional(),
    mode: z.union([z.number().int(), z.string()]).optional(),
  })
  .catchall(hruWriteValueSchema)
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one HRU value must be provided",
  });

// Type exports
export type HruWriteInput = z.infer<typeof hruWriteInputSchema>;
