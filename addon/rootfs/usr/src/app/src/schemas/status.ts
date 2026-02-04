import { z } from "zod";

export const modbusStatusQuerySchema = z.object({
  host: z.string().trim().optional(),
  port: z.union([z.string(), z.number()]).optional(),
});

export type ModbusStatusQuery = z.infer<typeof modbusStatusQuerySchema>;
