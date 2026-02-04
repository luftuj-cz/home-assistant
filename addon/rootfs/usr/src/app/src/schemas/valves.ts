import { z } from "zod";

export const valveUpdateParamsSchema = z.object({
  entityId: z.string().min(1, "entityId is required"),
});

export const valveUpdateBodySchema = z.object({
  value: z
    .union([z.number(), z.string()])
    .transform((val) => (typeof val === "string" ? Number(val) : val))
    .refine((val) => !Number.isNaN(val), { message: "Value must be a valid number" }),
});

export type ValveUpdateParams = z.infer<typeof valveUpdateParamsSchema>;
export type ValveUpdateBody = z.infer<typeof valveUpdateBodySchema>;
