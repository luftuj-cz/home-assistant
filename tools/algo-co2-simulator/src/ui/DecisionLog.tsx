import { Paper, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { memo, useMemo } from "react";

import type { LogEntry } from "../core/simulation.ts";
import { clockSecond } from "./chart.ts";
import { branchLabel, formatClock } from "./format.ts";
import type { SimulationControls } from "./useSimulation.ts";

type DecisionEntry = Extract<LogEntry, { kind: "decision" }>;

interface KeyedEntry {
  key: string;
  entry: LogEntry;
}

interface LogRowProps {
  entry: LogEntry;
  startSecondOfDay: number;
  roomNames: ReadonlyMap<string, string>;
}

/** The parts of a decision that changed something, after the clock and the branch. */
function decisionText(
  entry: DecisionEntry,
  clock: string,
  roomNames: ReadonlyMap<string, string>,
): string {
  const { report, valveChanges } = entry;
  const parts = [clock, branchLabel(report.branch)];
  if (report.roomsActedOn.length > 0) {
    parts.push(report.roomsActedOn.map((id) => roomNames.get(id) ?? id).join(", "));
  }
  if (valveChanges.length > 0) {
    parts.push(
      valveChanges.map((change) => `${change.valveId} ${change.from}→${change.to}`).join(", "),
    );
  }
  if (report.powerBefore !== report.powerAfter) {
    parts.push(`výkon ${report.powerBefore} → ${report.powerAfter}`);
  }
  return parts.join(" · ");
}

function LogRow({ entry, startSecondOfDay, roomNames }: Readonly<LogRowProps>) {
  if (entry.kind === "engine") {
    return (
      <Text size="xs" c="dimmed">
        {entry.message}
      </Text>
    );
  }
  const clock = formatClock(clockSecond(startSecondOfDay, entry.epochSecond));
  return <Text size="sm">{decisionText(entry, clock, roomNames)}</Text>;
}

/** Entries are never edited, so a row only re-renders when its own props change. */
const MemoLogRow = memo(LogRow);

/** A key from the entry's second and its place among the entries of that second, newest first. */
function keyedNewestFirst(log: readonly LogEntry[]): KeyedEntry[] {
  const keyed: KeyedEntry[] = [];
  let previousEpoch = Number.NaN;
  let repeat = 0;
  for (const entry of log) {
    repeat = entry.epochSecond === previousEpoch ? repeat + 1 : 0;
    previousEpoch = entry.epochSecond;
    keyed.push({ key: `${entry.epochSecond}:${repeat}`, entry });
  }
  return keyed.reverse();
}

export function DecisionLog({ controls }: Readonly<{ controls: SimulationControls }>) {
  const { house, log, startSecondOfDay } = controls;
  const roomNames = useMemo(
    () => new Map(house.rooms.map((room) => [room.id, room.name])),
    [house.rooms],
  );
  const rows = keyedNewestFirst(log);

  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Title order={4}>Rozhodnutí</Title>
        <ScrollArea h={320} type="auto">
          <Stack gap={4}>
            {rows.length === 0 && (
              <Text size="sm" c="dimmed">
                Zatím žádné zásahy.
              </Text>
            )}
            {rows.map(({ key, entry }) => (
              <MemoLogRow
                key={key}
                entry={entry}
                startSecondOfDay={startSecondOfDay}
                roomNames={roomNames}
              />
            ))}
          </Stack>
        </ScrollArea>
      </Stack>
    </Paper>
  );
}
