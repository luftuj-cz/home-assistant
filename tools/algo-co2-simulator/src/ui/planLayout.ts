import type { HouseRoom } from "../core/house.ts";
import type { RoomSnapshot } from "../core/simulation.ts";
import { co2Band } from "./format.ts";
import type { Co2Band } from "./format.ts";

export interface PlanViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The SVG view box, in metres, that covers every room with `paddingM` around them. */
export function planViewBox(rooms: readonly HouseRoom[], paddingM: number): PlanViewBox {
  const left = Math.min(...rooms.map((room) => room.rect.x));
  const top = Math.min(...rooms.map((room) => room.rect.y));
  const right = Math.max(...rooms.map((room) => room.rect.x + room.rect.w));
  const bottom = Math.max(...rooms.map((room) => room.rect.y + room.rect.d));
  return {
    x: left - paddingM,
    y: top - paddingM,
    w: right - left + 2 * paddingM,
    h: bottom - top + 2 * paddingM,
  };
}

/** The band a room is drawn in: none (no reading) when it has no working sensor, else by its actual CO2. */
export function roomCo2Band(room: RoomSnapshot, th1: number, th2: number): Co2Band {
  const hasReading = room.sensors.some((sensor) => !sensor.broken);
  return co2Band(hasReading ? room.co2Ppm : null, th1, th2);
}

/** A text's width in em, i.e. as a multiple of its font size. */
export type MeasureEm = (text: string, weight: number) => number;

export interface RoomTextLine {
  key: string;
  text: string;
  /** Baseline, in metres from the room's top edge. */
  y: number;
  fontSize: number;
  weight: number;
}

/** Base text metrics of a room on the plan, in metres. */
export const ROOM_TEXT = {
  nameSizeM: 0.36,
  lineSizeM: 0.3,
  lineHeightM: 0.42,
  firstBaselineM: 0.5,
  insetM: 0.2,
  descentEm: 0.3,
  minScale: 0.5,
} as const;

const NAME_WEIGHT = 600;
const LINE_WEIGHT = 400;
const LINE_SEPARATOR = " · ";

/**
 * Lays out a room's name and detail lines so they fit the room. A detail line too wide for the
 * room is broken at its separators; then everything shrinks together, down to `minScale`, until
 * the widest line and the last line fit.
 */
export function layoutRoomText(
  name: string,
  details: readonly { key: string; text: string }[],
  rect: { w: number; d: number },
  measureEm: MeasureEm,
): RoomTextLine[] {
  const availableW = rect.w - 2 * ROOM_TEXT.insetM;
  const lines: Omit<RoomTextLine, "y">[] = [
    { key: "name", text: name, fontSize: ROOM_TEXT.nameSizeM, weight: NAME_WEIGHT },
  ];
  for (const detail of details) {
    const tooWide = measureEm(detail.text, LINE_WEIGHT) * ROOM_TEXT.lineSizeM > availableW;
    const parts = tooWide ? detail.text.split(LINE_SEPARATOR) : [detail.text];
    parts.forEach((part, index) => {
      lines.push({
        key: parts.length > 1 ? `${detail.key}:${index}` : detail.key,
        text: part,
        fontSize: ROOM_TEXT.lineSizeM,
        weight: LINE_WEIGHT,
      });
    });
  }

  const last = lines.at(-1) ?? lines[0];
  const lastBaseline = ROOM_TEXT.firstBaselineM + (lines.length - 1) * ROOM_TEXT.lineHeightM;
  const neededD = lastBaseline + ROOM_TEXT.descentEm * (last?.fontSize ?? ROOM_TEXT.lineSizeM);
  const widest = Math.max(
    ...lines.map((line) => measureEm(line.text, line.weight) * line.fontSize),
  );
  const scale = Math.max(ROOM_TEXT.minScale, Math.min(1, rect.d / neededD, availableW / widest));

  return lines.map((line, index) => ({
    ...line,
    fontSize: line.fontSize * scale,
    y: (ROOM_TEXT.firstBaselineM + index * ROOM_TEXT.lineHeightM) * scale,
  }));
}

export type ValveState = "otevřeno" | "částečně" | "zavřeno";

/** Open up to the position the engine calls fully open, closed from the position that passes no air. */
export function valveState(
  position: number,
  fullyOpenValue: number,
  fullyClosedPosition: number,
): ValveState {
  if (position <= fullyOpenValue) {
    return "otevřeno";
  }
  return position >= fullyClosedPosition ? "zavřeno" : "částečně";
}
