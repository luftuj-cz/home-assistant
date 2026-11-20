import { ActionIcon, Button, Group, SegmentedControl, Select, Text } from "@mantine/core";
import { TimePicker } from "@mantine/dates";
import { IconPlayerPause, IconPlayerPlay, IconPlayerSkipForward } from "@tabler/icons-react";

import { formatClock, formatHhMm, parseHhMm } from "./format.ts";
import { SPEEDS } from "./runLoop.ts";
import type { SimulationControls } from "./useSimulation.ts";

const NO_SCENARIO = "none";
const HH_MM_LENGTH = 5;
/** The two selects share a row on a phone and stop growing on a wide screen. */
const SELECT_STYLE = { flex: "1 1 150px", maxWidth: 260 };

interface TopBarProps {
  controls: SimulationControls;
  onOpenParameters: () => void;
}

export function TopBar({ controls, onOpenParameters }: Readonly<TopBarProps>) {
  const { house, houses, scenarioId, snapshot, playing, speed } = controls;

  const scenarios = [
    { value: NO_SCENARIO, label: "Bez scénáře" },
    ...house.scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
  ];

  /** The picker reports a time only once it is complete, and an empty text while it is not. */
  function changeStart(text: string): void {
    const secondOfDay = parseHhMm(text.slice(0, HH_MM_LENGTH));
    if (secondOfDay !== null && secondOfDay !== controls.startSecondOfDay) {
      controls.setStartSecondOfDay(secondOfDay);
    }
  }

  return (
    <Group gap="md" align="flex-end" wrap="wrap">
      <Select
        label="Dům"
        data={houses.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        value={house.id}
        onChange={(id) => id !== null && controls.setHouse(id)}
        allowDeselect={false}
        style={SELECT_STYLE}
      />
      <Select
        label="Scénář"
        data={scenarios}
        value={scenarioId ?? NO_SCENARIO}
        onChange={(id) => id !== null && controls.setScenario(id === NO_SCENARIO ? null : id)}
        allowDeselect={false}
        style={SELECT_STYLE}
      />
      <TimePicker
        label="Začátek"
        format="24h"
        value={formatHhMm(controls.startSecondOfDay)}
        onChange={changeStart}
        hoursInputLabel="Začátek, hodiny"
        minutesInputLabel="Začátek, minuty"
      />
      <Group gap="md" align="center" wrap="wrap">
        <ActionIcon
          size="input-sm"
          aria-label={playing ? "Pozastavit" : "Spustit"}
          onClick={playing ? controls.pause : controls.play}
        >
          {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
        </ActionIcon>
        <ActionIcon
          size="input-sm"
          variant="default"
          aria-label="Krok o 1 sekundu"
          title="Krok o 1 sekundu"
          disabled={playing}
          onClick={controls.stepOnce}
        >
          <IconPlayerSkipForward size={18} />
        </ActionIcon>
        <SegmentedControl
          aria-label="Rychlost simulace"
          data={SPEEDS.map((value) => ({ value: String(value), label: `×${value}` }))}
          value={String(speed)}
          onChange={(value) => controls.setSpeed(Number(value))}
        />
        <Text
          fw={600}
          size="lg"
          style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          Den {snapshot.day} · {formatClock(snapshot.secondOfDay)}
        </Text>
      </Group>
      <Group gap="md" wrap="nowrap" ml="auto">
        <Button variant="default" onClick={controls.reset}>
          Reset
        </Button>
        <Button variant="default" onClick={onOpenParameters}>
          Parametry
        </Button>
      </Group>
    </Group>
  );
}
