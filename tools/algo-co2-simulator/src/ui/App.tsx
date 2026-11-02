import { Box, Stack } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useState } from "react";

import { ChartStrip } from "./ChartStrip.tsx";
import { DecisionLog } from "./DecisionLog.tsx";
import { FloorPlan } from "./FloorPlan.tsx";
import { HruPanel } from "./HruPanel.tsx";
import { ParameterDrawer } from "./ParameterDrawer.tsx";
import { RoomPanel } from "./RoomPanel.tsx";
import { TopBar } from "./TopBar.tsx";
import { useSimulation } from "./useSimulation.ts";

const DRAWER_WIDTH_PX = 480;

export function App() {
  const controls = useSimulation();
  const houseId = controls.house.id;
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectionHouseId, setSelectionHouseId] = useState(houseId);
  const [parametersOpen, setParametersOpen] = useState(false);
  const { ref: topBarRef, height: topBarHeight } = useElementSize();

  if (selectionHouseId !== houseId) {
    setSelectionHouseId(houseId);
    setSelectedRoomId(null);
  }

  const selectedRoom = controls.snapshot.rooms.find((room) => room.id === selectedRoomId) ?? null;

  return (
    <Stack gap="md" p="md">
      <Box ref={topBarRef}>
        <TopBar controls={controls} onOpenParameters={() => setParametersOpen(true)} />
      </Box>
      <Stack gap="md" pr={parametersOpen ? DRAWER_WIDTH_PX : 0}>
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: "var(--mantine-spacing-md)",
          }}
        >
          <FloorPlan
            controls={controls}
            selectedRoomId={selectedRoom?.id ?? null}
            onSelect={setSelectedRoomId}
          />
          <Stack component="aside" gap="md">
            <RoomPanel controls={controls} room={selectedRoom} />
            <HruPanel controls={controls} />
          </Stack>
        </Box>
        <Box
          component="section"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)",
            gap: "var(--mantine-spacing-md)",
          }}
        >
          <ChartStrip controls={controls} />
          <DecisionLog controls={controls} />
        </Box>
      </Stack>
      <ParameterDrawer
        opened={parametersOpen}
        width={DRAWER_WIDTH_PX}
        top={`calc(var(--mantine-spacing-md) * 2 + ${topBarHeight}px)`}
        onClose={() => setParametersOpen(false)}
        controls={controls}
      />
    </Stack>
  );
}
