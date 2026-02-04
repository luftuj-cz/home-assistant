import { z } from "zod";

export const modbusStatusQuerySchema = z.object({
  host: z.string().trim().optional(),
  port: z
    .string()
    .optional()
    .transform((val) => (val ? Number.parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(1).max(65535).optional()),
});

export type ModbusStatusQuery = z.infer<typeof modbusStatusQuerySchema>;
