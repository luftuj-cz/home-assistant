import { useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";

import type { HouseRoom } from "../core/house.ts";
import type { RoomSnapshot } from "../core/simulation.ts";
import type { Co2Band } from "./format.ts";
import { ROOM_TEXT, layoutRoomText, planViewBox, roomCo2Band, valveState } from "./planLayout.ts";
import { measureTextEm } from "./textMeasure.ts";
import type { SimulationControls } from "./useSimulation.ts";

const PLAN_PADDING_M = 0.5;
const HATCH_ID = "no-reading-hatch";
const HATCH_SPACING_M = 0.25;

const FOCUS_INSET_M = 0.1;

const BAND_FILL: Record<Co2Band, string> = {
  ok: "var(--mantine-color-green-light)",
  warn: "var(--mantine-color-orange-light)",
  bad: "var(--mantine-color-red-light)",
  none: `url(#${HATCH_ID})`,
};

const VALVE_LABEL = { supply: "přívod", exhaust: "odtah" } as const;

interface FloorPlanProps {
  controls: SimulationControls;
  selectedRoomId: string | null;
  onSelect: (roomId: string | null) => void;
}

interface PlanRoomProps {
  houseRoom: HouseRoom;
  room: RoomSnapshot;
  band: Co2Band;
  fullyOpenValue: number;
  fullyClosedPosition: number;
  selected: boolean;
  onToggle: () => void;
}

function roomLines(
  room: RoomSnapshot,
  fullyOpenValue: number,
  fullyClosedPosition: number,
): { key: string; text: string }[] {
  return [
    { key: "co2", text: `${Math.round(room.co2Ppm)} ppm` },
    { key: "people", text: `${room.occupancy.people} os.` },
    ...room.valves.map((valve) => ({
      key: valve.id,
      text: `${VALVE_LABEL[valve.type]} ${valve.position} · ${valveState(valve.position, fullyOpenValue, fullyClosedPosition)}`,
    })),
  ];
}

function PlanRoom({
  houseRoom,
  room,
  band,
  fullyOpenValue,
  fullyClosedPosition,
  selected,
  onToggle,
}: Readonly<PlanRoomProps>) {
  const { x, y, w, d } = houseRoom.rect;
  const [focusVisible, setFocusVisible] = useState(false);

  function onFocus(event: FocusEvent<SVGGElement>): void {
    setFocusVisible(event.currentTarget.matches(":focus-visible"));
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  }

  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${room.name}, ${Math.round(room.co2Ppm)} ppm`}
      style={{ cursor: "pointer", outline: "none" }}
      onClick={onToggle}
      onFocus={onFocus}
      onBlur={() => setFocusVisible(false)}
      onKeyDown={onKeyDown}
    >
      <rect
        x={x}
        y={y}
        width={w}
        height={d}
        strokeWidth={0.04}
        style={{ fill: BAND_FILL[band], stroke: "var(--mantine-color-default-border)" }}
      />
      <svg x={x} y={y} width={w} height={d}>
        {layoutRoomText(
          room.name,
          roomLines(room, fullyOpenValue, fullyClosedPosition),
          houseRoom.rect,
          measureTextEm,
        ).map((line) => (
          <text
            key={line.key}
            x={ROOM_TEXT.insetM}
            y={line.y}
            fontSize={line.fontSize}
            fontWeight={line.weight}
            style={{ fill: "var(--mantine-color-text)" }}
          >
            {line.text}
          </text>
        ))}
      </svg>
      {focusVisible && (
        <rect
          x={x + FOCUS_INSET_M}
          y={y + FOCUS_INSET_M}
          width={w - 2 * FOCUS_INSET_M}
          height={d - 2 * FOCUS_INSET_M}
          fill="none"
          strokeWidth={0.05}
          strokeDasharray="0.2 0.12"
          pointerEvents="none"
          style={{ stroke: "var(--mantine-color-text)" }}
        />
      )}
    </g>
  );
}

export function FloorPlan({ controls, selectedRoomId, onSelect }: Readonly<FloorPlanProps>) {
  const { house, snapshot, engineParams, settings } = controls;
  const box = planViewBox(house.rooms, PLAN_PADDING_M);
  const selectedHouseRoom = house.rooms.find((candidate) => candidate.id === selectedRoomId);

  return (
    <svg
      role="group"
      aria-label="Půdorys domu"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{
        display: "block",
        width: "100%",
        height: "auto",
        maxHeight: "65vh",
        userSelect: "none",
      }}
    >
      <defs>
        <pattern
          id={HATCH_ID}
          width={HATCH_SPACING_M}
          height={HATCH_SPACING_M}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect
            width={HATCH_SPACING_M}
            height={HATCH_SPACING_M}
            style={{ fill: "var(--mantine-color-gray-light)" }}
          />
          <line
            x1={0}
            y1={0}
            x2={0}
            y2={HATCH_SPACING_M}
            strokeWidth={0.05}
            strokeOpacity={0.5}
            style={{ stroke: "var(--mantine-color-gray-5)" }}
          />
        </pattern>
      </defs>
      {house.rooms.map((houseRoom) => {
        const room = snapshot.rooms.find((candidate) => candidate.id === houseRoom.id);
        if (room === undefined) {
          return null;
        }
        const selected = houseRoom.id === selectedRoomId;
        return (
          <PlanRoom
            key={houseRoom.id}
            houseRoom={houseRoom}
            room={room}
            band={roomCo2Band(room, engineParams.th1, engineParams.th2)}
            fullyOpenValue={engineParams.fullyOpenValue}
            fullyClosedPosition={settings.valveFullyClosedPosition}
            selected={selected}
            onToggle={() => onSelect(selected ? null : houseRoom.id)}
          />
        );
      })}
      {selectedHouseRoom !== undefined && (
        <rect
          x={selectedHouseRoom.rect.x}
          y={selectedHouseRoom.rect.y}
          width={selectedHouseRoom.rect.w}
          height={selectedHouseRoom.rect.d}
          fill="none"
          strokeWidth={0.12}
          pointerEvents="none"
          style={{ stroke: "var(--mantine-primary-color-filled)" }}
        />
      )}
    </svg>
  );
}
