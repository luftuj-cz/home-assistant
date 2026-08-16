import { z } from "zod";
import { SEASON_KEYS } from "../services/db/seasons.js";

/** MM-DD with no year: a season boundary repeats every calendar year. */
const monthDaySchema = z
  .string()
  .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Boundary must be in MM-DD format");

export const seasonKeySchema = z.enum(SEASON_KEYS);

export const seasonUpdateInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    spanStart: monthDaySchema.optional(),
  })
  .refine((value) => value.enabled !== undefined || value.spanStart !== undefined, {
    message: "Provide enabled, spanStart, or both",
  });

export const seasonsEnableInputSchema = z.object({
  /**
   * Copy the current schedule and mode values into every created season, so
   * enabling the feature cannot change what the unit is doing.
   */
  cloneCurrent: z.boolean().default(true),
});

export const seasonsDisableInputSchema = z.object({
  /**
   * Which season's content survives. Spring by default: it is the key a
   * one-season install always uses, so an enable/disable round trip keeps the
   * schedule in the same place.
   */
  keepSeasonKey: seasonKeySchema.default("spring"),
});

export type SeasonUpdateInput = z.infer<typeof seasonUpdateInputSchema>;
export type SeasonsEnableInput = z.infer<typeof seasonsEnableInputSchema>;
export type SeasonsDisableInput = z.infer<typeof seasonsDisableInputSchema>;
