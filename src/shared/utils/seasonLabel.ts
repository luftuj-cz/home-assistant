/** What the user sees for a season: their own name, else the translated default. */
export function seasonLabel(
  season: { seasonKey: string; name?: string | null },
  t: (key: string) => string,
): string {
  return season.name || t(`settings.seasons.names.${season.seasonKey}`);
}
