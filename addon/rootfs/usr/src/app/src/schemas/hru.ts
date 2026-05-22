import { z } from "zod";

const hruWriteValueSchema = z.union([z.number(), z.string(), z.boolean()]);

// HRU Write Schema
export const hruWriteInputSchema = z
  .looseObject({
    power: z.number().optional(),
    temperature: z.number().optional(),
    mode: z.union([z.number().int(), z.string()]).optional(),
  })
  .catchall(hruWriteValueSchema)
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one HRU value must be provided",
    },
  );

// Type exports
export type HruWriteInput = z.infer<typeof hruWriteInputSchema>;
