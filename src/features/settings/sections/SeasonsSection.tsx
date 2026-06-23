import { Accordion, Alert, Paper, Select, Stack, Text } from "@mantine/core";
import { IconLeaf } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { useSeasonHemisphere } from "@luftuj/features/timeline/hooks/useSeasonHemisphere";
import type { Hemisphere } from "@luftuj/shared/types/timeline";

export function SeasonsSection() {
  const { t } = useTranslation();
  const { data, save } = useSeasonHemisphere();

  return (
    <Accordion.Item value="seasons">
      <Accordion.Control icon={<IconLeaf size={20} />}>
        <Text fw={600}>{t("settings.timeline.seasons.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Paper p="md" withBorder radius="md">
          <Stack gap="md">
            <Select
              label={t("settings.timeline.seasons.hemisphere")}
              data={[
                { value: "northern", label: t("settings.timeline.seasons.hemisphereNorthern") },
                { value: "southern", label: t("settings.timeline.seasons.hemisphereSouthern") },
              ]}
              value={data?.hemisphere ?? "northern"}
              onChange={(v) => {
                if (v === "northern" || v === "southern") {
                  save.mutate(v as Hemisphere, {
                    onSuccess: () =>
                      notifications.show({
                        message: t("settings.timeline.seasons.saveSuccess", {
                          season: t("settings.timeline.seasons.hemisphere"),
                        }),
                      }),
                  });
                }
              }}
            />
            <Text size="xs" c="dimmed">
              {t("settings.timeline.seasons.description")}
            </Text>
            <Alert color="blue" variant="light">
              {t("settings.timeline.seasons.settingsInfo")}
            </Alert>
          </Stack>
        </Paper>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
