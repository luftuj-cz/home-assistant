import { Group, Paper, SegmentedControl, Slider, Stack, Switch, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import type { House } from "../core/house.ts";
import type { RoomSnapshot } from "../core/simulation.ts";
import type { Activity } from "../core/settings.ts";
import { formatDuration } from "./format.ts";
import type { SimulationControls } from "./useSimulation.ts";

const NO_VALUE = "—";
const MIN_SLIDER_PEOPLE = 10;
const MAX_SLIDER_MARKS = 11;

/** The slider's top: the most people any scenario of the house puts in one room, at least 10. */
function sliderMax(house: House, people: number): number {
  const scripted = house.scenarios.flatMap((scenario) => scenario.steps.map((step) => step.people));
  return Math.max(MIN_SLIDER_PEOPLE, people, ...scripted);
}

/** A mark per person while they fit, then every second, third… one. */
function peopleMarks(max: number): { value: number; label: string }[] {
  const stride = Math.ceil((max + 1) / MAX_SLIDER_MARKS);
  const marks = [];
  for (let people = 0; people <= max; people += stride) {
    marks.push({ value: people, label: String(people) });
  }
  return marks;
}

const ACTIVITIES: { value: Activity; label: string }[] = [
  { value: "sleeping", label: "Spí" },
  { value: "sitting", label: "Sedí" },
  { value: "active", label: "Aktivní" },
];

interface RoomPanelProps {
  controls: SimulationControls;
  room: RoomSnapshot | null;
}

function ppm(value: number | null): string {
  return value === null ? NO_VALUE : `${Math.round(value)} ppm`;
}

/** How long a timer has run against the time limit, or a dash when it is not running. */
function timer(nowEpoch: number, since: number | null, limitS: number): string {
  if (since === null) {
    return NO_VALUE;
  }
  return `${formatDuration(nowEpoch - since)} / ${formatDuration(limitS)}`;
}

function Row({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm">{label}</Text>
      <Text size="sm" fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
        {children}
      </Text>
    </Group>
  );
}

export function RoomPanel({ controls, room }: Readonly<RoomPanelProps>) {
  if (room === null) {
    return (
      <Paper withBorder p="md">
        <Text c="dimmed">Vyberte místnost na půdorysu</Text>
      </Paper>
    );
  }

  const { snapshot, engineParams } = controls;
  const { people, activity } = room.occupancy;
  const nowEpoch = snapshot.epochSecond;
  const limitS = engineParams.thresholdTimeLimit;
  const belowLimitS = engineParams.belowTimeLimit;
  const maxPeople = sliderMax(controls.house, people);

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Title order={4}>{room.name}</Title>

        <Stack gap={4} pb="md">
          <Text size="sm">Lidé</Text>
          <Slider
            min={0}
            max={maxPeople}
            step={1}
            marks={peopleMarks(maxPeople)}
            thumbLabel="Počet lidí"
            value={people}
            onChange={(next) => controls.setOccupancy(room.id, { people: next, activity })}
          />
        </Stack>

        <Stack gap={4}>
          <Text size="sm">Činnost</Text>
          <SegmentedControl
            fullWidth
            aria-label="Činnost"
            data={ACTIVITIES}
            value={activity}
            onChange={(next) => controls.setOccupancy(room.id, { people, activity: next })}
          />
        </Stack>

        <Row label="Skutečné CO2">{ppm(room.co2Ppm)}</Row>
        <Row label="Vyhlazené CO2 (algoritmus)">{ppm(room.filteredCo2Ppm)}</Row>

        {room.sensors.map((sensor) => (
          <Stack key={sensor.id} gap={4}>
            <Row label={sensor.id}>{ppm(sensor.reading)}</Row>
            <Switch
              label="Čidlo nefunguje"
              checked={sensor.broken}
              onChange={(event) => controls.setSensorBroken(sensor.id, event.currentTarget.checked)}
            />
          </Stack>
        ))}

        <Row label="Nad TH1">{timer(nowEpoch, room.aboveSince.th1, limitS)}</Row>
        <Row label="Nad TH2">{timer(nowEpoch, room.aboveSince.th2, limitS)}</Row>
        <Row label="Pod TH1 − hystereze">{timer(nowEpoch, room.belowSince.th1, belowLimitS)}</Row>
        <Row label="Od posledního zásahu">
          {room.lastChangeEpoch === null
            ? NO_VALUE
            : formatDuration(nowEpoch - room.lastChangeEpoch)}
        </Row>
      </Stack>
    </Paper>
  );
}
