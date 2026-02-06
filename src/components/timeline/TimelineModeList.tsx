import {
  Button,
  Card,
  Group,
  Stack,
  Text,
  Title,
  ActionIcon,
  Badge,
  ColorSwatch,
  SimpleGrid,
} from "@mantine/core";
import { IconPlus, IconEdit, IconTrash } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import type { Mode } from "../../types/timeline";
import { formatTemperature, getTemperatureLabel } from "../../utils/temperature";
import type { TemperatureUnit } from "../../hooks/useDashboardStatus";

interface TimelineModeListProps {
  modes: Mode[];
  onAdd: () => void;
  onEdit: (mode: Mode) => void;
  onDelete: (id: number) => void;
  t: TFunction;
  powerUnit?: string;
  temperatureUnit?: TemperatureUnit;
}

export function TimelineModeList({
  modes,
  onAdd,
  onEdit,
  onDelete,
  t,
  powerUnit = "%",
  temperatureUnit = "c",
}: TimelineModeListProps) {
  return (
    <Card withBorder radius="md" padding="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={4} fw={700}>
              {t("settings.timeline.modesTitle", { defaultValue: "Modes" })}
            </Title>
            <Badge variant="light" color="gray" size="sm">
              {modes.length}
            </Badge>
          </Group>
          <Button size="xs" variant="outline" leftSection={<IconPlus size={14} />} onClick={onAdd}>
            {t("settings.timeline.addMode", { defaultValue: "Add mode" })}
          </Button>
        </Group>

        {modes.length === 0 ? (
          <Card
            withBorder
            radius="lg"
            padding="md"
            style={{ backgroundColor: "rgba(255, 255, 255, 0.05)", backdropFilter: "blur(10px)" }}
          >
            <Stack align="center" gap="xs">
              <Text size="sm" c="dimmed">
                {t("settings.timeline.noModes", { defaultValue: "No modes yet." })}
              </Text>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconPlus size={14} />}
                onClick={onAdd}
              >
                {t("settings.timeline.addMode")}
              </Button>
            </Stack>
          </Card>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
            {modes.map((m) => (
              <Card
                key={m.id}
                withBorder
                padding="md"
                radius="lg"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/json", JSON.stringify(m));
                  e.dataTransfer.effectAllowed = "copy";
                }}
                style={{
                  borderTop: `6px solid ${m.color || "var(--mantine-color-blue-6)"}`,
                  backgroundColor: "rgba(255, 255, 255, 0.05)",
                  backdropFilter: "blur(10px)",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                  cursor: "grab",
                }}
                styles={{
                  root: {
                    "&:hover": {
                      transform: "translateY(-2px)",
                      boxShadow: "var(--mantine-shadow-md)",
                    },
                  },
                }}
              >
                <Stack gap="md">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={4}>
                      <Group gap={8} wrap="nowrap">
                        <ColorSwatch color={m.color || "blue"} size={16} />
                        <Title
                          order={5}
                          style={{
                            maxWidth: 140,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {m.name}
                        </Title>
                      </Group>
                      <Group gap={6}>
                        {m.isBoost && (
                          <Badge size="xs" color="orange" variant="light" radius="sm">
                            {t("settings.timeline.modeIsBoostBadge", { defaultValue: "BOOST" })}
                          </Badge>
                        )}
                        {m.power !== undefined && (
                          <Badge size="md" variant="outline" color="blue" radius="sm" fw={700}>
                            {m.power}
                            {t(`app.units.${powerUnit}`, { defaultValue: powerUnit })}
                          </Badge>
                        )}
                        {m.temperature !== undefined && (
                          <Badge size="md" variant="outline" color="red" radius="sm" fw={700}>
                            {formatTemperature(m.temperature, temperatureUnit).toFixed(1)}
                            {getTemperatureLabel(temperatureUnit)}
                          </Badge>
                        )}
                      </Group>
                    </Stack>

                    <Group gap={4} wrap="nowrap">
                      <ActionIcon
                        size="lg"
                        variant="subtle"
                        aria-label="Edit mode"
                        onClick={() => onEdit(m)}
                        radius="md"
                      >
                        <IconEdit size={20} />
                      </ActionIcon>
                      <ActionIcon
                        size="lg"
                        variant="subtle"
                        color="red"
                        aria-label="Delete mode"
                        onClick={() => onDelete(m.id)}
                        radius="md"
                      >
                        <IconTrash size={20} />
                      </ActionIcon>
                    </Group>
                  </Group>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Card>
  );
}
