import { Box, Stack } from "@mantine/core";
import { useElementSize, useMediaQuery } from "@mantine/hooks";
import { useState } from "react";

import { ChartStrip } from "./ChartStrip.tsx";
import { DecisionLog } from "./DecisionLog.tsx";
import { FloorPlan } from "./FloorPlan.tsx";
import { HruPanel } from "./HruPanel.tsx";
import { ParameterDrawer } from "./ParameterDrawer.tsx";
import { RoomPanel } from "./RoomPanel.tsx";
import { TopBar } from "./TopBar.tsx";
import { useSimulation } from "./useSimulation.ts";
import "./layout.css";

const DRAWER_WIDTH_PX = 480;
/** From this width the drawer sits beside the page; below it, it lies over the page. */
const DOCKED_DRAWER_QUERY = "(min-width: 1100px)";

export function App() {
  const controls = useSimulation();
  const houseId = controls.house.id;
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectionHouseId, setSelectionHouseId] = useState(houseId);
  const [parametersOpen, setParametersOpen] = useState(false);
  const { ref: topBarRef, height: topBarHeight } = useElementSize();
  const drawerDocked =
    useMediaQuery(DOCKED_DRAWER_QUERY, true, { getInitialValueInEffect: false }) ?? true;

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
      <Stack
        className="sim-content"
        gap="md"
        pr={parametersOpen && drawerDocked ? DRAWER_WIDTH_PX : 0}
      >
        <Box className="sim-main">
          <FloorPlan
            controls={controls}
            selectedRoomId={selectedRoom?.id ?? null}
            onSelect={setSelectedRoomId}
          />
          <Box component="aside" className="sim-side">
            <RoomPanel controls={controls} room={selectedRoom} />
            <HruPanel controls={controls} />
          </Box>
        </Box>
        <Box component="section" className="sim-bottom">
          <ChartStrip controls={controls} />
          <DecisionLog controls={controls} />
        </Box>
      </Stack>
      <ParameterDrawer
        opened={parametersOpen}
        docked={drawerDocked}
        width={DRAWER_WIDTH_PX}
        top={`calc(var(--mantine-spacing-md) * 2 + ${topBarHeight}px)`}
        onClose={() => setParametersOpen(false)}
        controls={controls}
      />
    </Stack>
  );
}
