import { z } from "zod";

const hruWriteValueSchema = z.union([z.number(), z.string(), z.boolean()]);

// HRU Write Schema
export const hruWriteInputSchema = z
  .looseObject({
    power: z
      .number()
      .int("Power must be a whole number")
      .min(0, "Power must be at least 0")
      .max(65535, "Power must be at most 65535")
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
