import { z } from "zod";

export const roomIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
});

export const roomGroupParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be numeric"),
  groupId: z.string().regex(/^\d+$/, "groupId must be numeric"),
});

const roomSensorSchema = z.object({
  entityId: z.string().trim().min(1, "entityId is required"),
  attribute: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null),
});

export const roomInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(100),
  sortOrder: z.number().int().optional(),
  valves: z.array(z.string().trim().min(1)).default([]),
  sensors: z.array(roomSensorSchema).default([]),
});

export const journalQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export type RoomIdParams = z.infer<typeof roomIdParamsSchema>;
export type RoomGroupParams = z.infer<typeof roomGroupParamsSchema>;
export type RoomInputBody = z.infer<typeof roomInputSchema>;
