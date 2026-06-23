import { Accordion, Badge, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useSeasonalModesQuery } from "../hooks/useSeasonalModesQuery";
import { useSeasonHemisphere } from "../hooks/useSeasonHemisphere";
import { resolveSeason } from "../utils/season";
import { SeasonalModeModal } from "./SeasonalModeModal";
import type { HruVariable } from "@luftuj/shared/api/hru";
import type { Season } from "@luftuj/shared/types/timeline";
import type { Valve } from "@luftuj/shared/types/valve";

const SEASONS: Season[] = ["spring", "summer", "autumn", "winter"];

interface Props {
  unitId: string | null;
  valves: Valve[];
  hruVariables: HruVariable[];
  maxPower?: number;
}

export function SeasonalModeList({ unitId, valves, hruVariables, maxPower }: Props) {
  const { t } = useTranslation();
  const { data: hemisphereData } = useSeasonHemisphere();
  const { data: rows = [], isLoading, save, remove } = useSeasonalModesQuery(unitId);
  const [editing, setEditing] = useState<Season | null>(null);
  const [opened, { open, close }] = useDisclosure(false);

  if (isLoading) return <Loader />;
  const bySeason = new Map(rows.map((r) => [r.season, r]));
  const currentSeason = resolveSeason(new Date(), hemisphereData?.hemisphere ?? "northern");

  const startEdit = (season: Season) => {
    setEditing(season);
    open();
  };

  return (
    <Stack>
      <Text fw={600}>{t("settings.timeline.seasons.title")}</Text>
      <Text size="sm" c="dimmed">
        {t("settings.timeline.seasons.description")}
      </Text>
      <Text size="sm">
        {t("settings.timeline.seasons.currentSeason")}:{" "}
        <b>{t(`settings.timeline.seasons.${currentSeason}`)}</b>
      </Text>
      <Accordion variant="separated">
        {SEASONS.map((season) => {
          const row = bySeason.get(season) ?? null;
          return (
            <Accordion.Item key={season} value={season}>
              <Accordion.Control>
                <Group justify="space-between">
                  <Text>{t(`settings.timeline.seasons.${season}`)}</Text>
                  {row ? (
                    <Badge color="green">{t("settings.timeline.seasons.configured")}</Badge>
                  ) : (
                    <Badge color="gray">{t("settings.timeline.seasons.notConfigured")}</Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Group>
                  <Button onClick={() => startEdit(season)}>
                    {row ? t("settings.timeline.edit") : t("settings.timeline.modeCreateAction")}
                  </Button>
                  {row && (
                    <Button
                      variant="default"
                      color="red"
                      onClick={() => {
                        remove.mutate(season, {
                          onSuccess: () =>
                            notifications.show({
                              message: t("settings.timeline.seasons.removeSuccess", {
                                season: t(`settings.timeline.seasons.${season}`),
                              }),
                            }),
                        });
                      }}
                    >
                      {t("settings.timeline.seasons.remove")}
                    </Button>
                  )}
                </Group>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
      <SeasonalModeModal
        opened={opened}
        season={editing}
        initial={editing ? (bySeason.get(editing) ?? null) : null}
        unitId={unitId}
        valves={valves}
        hruVariables={hruVariables}
        maxPower={maxPower}
        onClose={close}
        pending={save.isPending}
        onSubmit={(body) => {
          if (!editing) return;
          save.mutate(
            { season: editing, body },
            {
              onSuccess: () => {
                notifications.show({
                  message: t("settings.timeline.seasons.saveSuccess", {
                    season: t(`settings.timeline.seasons.${editing}`),
                  }),
                });
                close();
              },
            },
          );
        }}
      />
    </Stack>
  );
}
