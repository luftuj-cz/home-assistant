import { z } from "zod";

export const valveGroupIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

export const valveGroupInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  sortOrder: z.number().int().optional(),
});

export const valveGroupMembersBodySchema = z.object({
  entityIds: z.array(z.string().min(1)),
});

export const valveGroupBulkSetBodySchema = z.object({
  value: z
    .union([z.number(), z.string()])
    .transform((val) => (typeof val === "string" ? Number(val) : val))
    .refine((val) => !Number.isNaN(val), { message: "Value must be a valid number" }),
});

export type ValveGroupIdParams = z.infer<typeof valveGroupIdParamsSchema>;
export type ValveGroupInput = z.infer<typeof valveGroupInputSchema>;
export type ValveGroupMembersBody = z.infer<typeof valveGroupMembersBodySchema>;
export type ValveGroupBulkSetBody = z.infer<typeof valveGroupBulkSetBodySchema>;
