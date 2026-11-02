import { ActionIcon, Button, Group, SegmentedControl, Select, Text } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useState } from "react";
import type { ChangeEvent } from "react";

import { formatClock, formatHhMm, parseHhMm } from "./format.ts";
import { SPEEDS } from "./runLoop.ts";
import type { SimulationControls } from "./useSimulation.ts";

const NO_SCENARIO = "none";

interface TopBarProps {
  controls: SimulationControls;
  onOpenParameters: () => void;
}

export function TopBar({ controls, onOpenParameters }: TopBarProps) {
  const { house, houses, scenarioId, snapshot, playing, speed } = controls;
  const [startDraft, setStartDraft] = useState(formatHhMm(controls.startSecondOfDay));

  const scenarios = [
    { value: NO_SCENARIO, label: "Bez scénáře" },
    ...house.scenarios.map((scenario) => ({ value: scenario.id, label: scenario.name })),
  ];

  function changeStart(event: ChangeEvent<HTMLInputElement>): void {
    const text = event.currentTarget.value;
    setStartDraft(text);
    const secondOfDay = parseHhMm(text);
    if (secondOfDay !== null) {
      controls.setStartSecondOfDay(secondOfDay);
    }
  }

  return (
    <Group gap="md" align="flex-end" wrap="nowrap">
      <Select
        label="Dům"
        data={houses.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        value={house.id}
        onChange={(id) => id !== null && controls.setHouse(id)}
        allowDeselect={false}
      />
      <Select
        label="Scénář"
        data={scenarios}
        value={scenarioId ?? NO_SCENARIO}
        onChange={(id) => id !== null && controls.setScenario(id === NO_SCENARIO ? null : id)}
        allowDeselect={false}
      />
      <TimeInput label="Začátek" value={startDraft} onChange={changeStart} />
      <ActionIcon
        size="input-sm"
        aria-label={playing ? "Pozastavit" : "Spustit"}
        onClick={playing ? controls.pause : controls.play}
      >
        {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
      </ActionIcon>
      <SegmentedControl
        data={SPEEDS.map((value) => ({ value: String(value), label: `×${value}` }))}
        value={String(speed)}
        onChange={(value) => controls.setSpeed(Number(value))}
      />
      <Text fw={600} size="lg" style={{ fontVariantNumeric: "tabular-nums" }}>
        Den {snapshot.day} · {formatClock(snapshot.secondOfDay)}
      </Text>
      <Button variant="default" onClick={controls.reset} ml="auto">
        Reset
      </Button>
      <Button variant="default" onClick={onOpenParameters}>
        Parametry
      </Button>
    </Group>
  );
}
