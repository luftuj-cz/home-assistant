import { Paper, Progress, Stack, Text, Title } from "@mantine/core";

import type { EngineParams } from "../core/engineParams.ts";
import { branchLabel } from "./format.ts";
import type { SimulationControls } from "./useSimulation.ts";

const NO_VALUE = "—";

/** The current HRU maximum, tagged day or night when the two parameters tell them apart. */
function maxPowerText(maxPower: number | null, params: EngineParams): string {
  if (maxPower === null) {
    return NO_VALUE;
  }
  if (params.hruMaxPowerDay === params.hruMaxPowerNight) {
    return `${maxPower}`;
  }
  if (maxPower === params.hruMaxPowerDay) {
    return `${maxPower} (den)`;
  }
  if (maxPower === params.hruMaxPowerNight) {
    return `${maxPower} (noc)`;
  }
  return `${maxPower}`;
}

export function HruPanel({ controls }: Readonly<{ controls: SimulationControls }>) {
  const { snapshot, engineParams } = controls;

  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Title order={4}>Rekuperace</Title>
        <Text size="sm">Výkon {snapshot.power} / 10</Text>
        <Progress value={snapshot.power * 10} aria-label="Výkon rekuperace" />
        <Text size="sm">Maximum teď: {maxPowerText(snapshot.maxPower, engineParams)}</Text>
        <Text size="sm">Průtok: {Math.round(snapshot.totalFlowM3h)} m³/h</Text>
        <Text size="sm">
          Poslední rozhodnutí:{" "}
          {snapshot.lastReport === null ? NO_VALUE : branchLabel(snapshot.lastReport.branch)}
        </Text>
        {engineParams.fluctuationEnabled && (
          <Text size="sm">
            Pohyb osob: {snapshot.lastReport?.fluctuationActive === true ? "aktivní" : "neaktivní"}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
