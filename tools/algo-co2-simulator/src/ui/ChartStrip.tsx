import {
  Box,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  useComputedColorScheme,
} from "@mantine/core";
import { useState } from "react";

import type { HouseRoom } from "../core/house.ts";
import type { HistorySample } from "../core/simulation.ts";
import {
  CO2_AXIS_MIN_PPM,
  clockSecond,
  co2YMax,
  polylinePoints,
  scaleX,
  scaleY,
  thinSamples,
  windowSamples,
  yTicks,
} from "./chart.ts";
import type { Domain } from "./chart.ts";
import { formatHhMm } from "./format.ts";
import type { SimulationControls } from "./useSimulation.ts";

const WINDOWS = [
  { value: "1800", label: "30 min" },
  { value: "7200", label: "2 h" },
  { value: "86400", label: "24 h" },
];
const DEFAULT_WINDOW_S = 1800;

/** One line should not need more points than the chart has pixels; 24 h holds 8640 samples. */
const MAX_LINE_POINTS = 800;

const VIEW_W = 800;
const MARGIN = { left: 44, right: 8, top: 10 };
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right;
const CO2_PLOT_H = 200;
const CO2_BOTTOM = 8;
const POWER_PLOT_H = 56;
const POWER_BOTTOM = 22;
const POWER_TICKS = [0, 50, 100];
const X_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const LABEL_SIZE = 11;

const ROOM_COLORS = ["blue", "grape", "teal", "cyan", "indigo", "lime", "pink", "violet"];

interface ChartProps {
  domain: Domain;
  samples: readonly HistorySample[];
  shade: number;
}

interface Co2ChartProps extends ChartProps {
  rooms: readonly HouseRoom[];
  th1: number;
  th2: number;
}

interface PowerChartProps extends ChartProps {
  startSecondOfDay: number;
}

function paletteColor(name: string, shade: number): string {
  return `var(--mantine-color-${name}-${shade})`;
}

function roomColor(index: number, shade: number): string {
  return paletteColor(ROOM_COLORS[index % ROOM_COLORS.length], shade);
}

function viewHeight(plotH: number, bottom: number): number {
  return MARGIN.top + plotH + bottom;
}

function inside(value: number, domain: Domain): boolean {
  return value >= domain.y0 && value <= domain.y1;
}

/** The faint vertical lines that tie the two charts to the same clock labels. */
function VerticalGrid({ plotH }: Readonly<{ plotH: number }>) {
  return X_FRACTIONS.map((fraction) => (
    <line
      key={fraction}
      x1={fraction * PLOT_W}
      x2={fraction * PLOT_W}
      y1={0}
      y2={plotH}
      stroke="var(--mantine-color-default-border)"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
    />
  ));
}

function HorizontalGrid({
  ticks,
  domain,
  plotH,
}: Readonly<{ ticks: readonly number[]; domain: Domain; plotH: number }>) {
  return ticks.map((tick) => {
    const y = scaleY(tick, domain, plotH);
    return (
      <g key={tick}>
        <line
          x1={0}
          x2={PLOT_W}
          y1={y}
          y2={y}
          stroke="var(--mantine-color-default-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <text
          x={-6}
          y={y + LABEL_SIZE / 3}
          textAnchor="end"
          fontSize={LABEL_SIZE}
          fill="var(--mantine-color-dimmed)"
        >
          {tick}
        </text>
      </g>
    );
  });
}

function Co2Chart({ domain, samples, shade, rooms, th1, th2 }: Readonly<Co2ChartProps>) {
  const size = { w: PLOT_W, h: CO2_PLOT_H };
  const thresholds = [
    { label: "TH1", value: th1, color: paletteColor("orange", shade) },
    { label: "TH2", value: th2, color: paletteColor("red", shade) },
  ].filter((threshold) => inside(threshold.value, domain));

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${viewHeight(CO2_PLOT_H, CO2_BOTTOM)}`}
      width="100%"
      role="img"
      aria-label="Průběh CO2 v místnostech a prahy TH1 a TH2"
    >
      <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
        <VerticalGrid plotH={CO2_PLOT_H} />
        <HorizontalGrid ticks={yTicks(domain.y0, domain.y1)} domain={domain} plotH={CO2_PLOT_H} />
        {rooms.map((room, index) => (
          <polyline
            key={room.id}
            points={polylinePoints(
              samples.flatMap((entry) => {
                const y = entry.co2Ppm[room.id];
                return y === undefined ? [] : [{ x: entry.epochSecond, y }];
              }),
              domain,
              size,
            )}
            fill="none"
            stroke={roomColor(index, shade)}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {thresholds.map((threshold) => {
          const y = scaleY(threshold.value, domain, CO2_PLOT_H);
          return (
            <g key={threshold.label}>
              <line
                x1={0}
                x2={PLOT_W}
                y1={y}
                y2={y}
                stroke={threshold.color}
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PLOT_W - 4}
                y={y - 4}
                textAnchor="end"
                fontSize={LABEL_SIZE}
                fill={threshold.color}
              >
                {threshold.label} {threshold.value}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function PowerChart({ domain, samples, shade, startSecondOfDay }: Readonly<PowerChartProps>) {
  const size = { w: PLOT_W, h: POWER_PLOT_H };
  const powerDomain: Domain = { ...domain, y0: 0, y1: 100 };
  const spanS = domain.x1 - domain.x0;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${viewHeight(POWER_PLOT_H, POWER_BOTTOM)}`}
      width="100%"
      role="img"
      aria-label="Výkon rekuperace"
    >
      <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
        <VerticalGrid plotH={POWER_PLOT_H} />
        <HorizontalGrid ticks={POWER_TICKS} domain={powerDomain} plotH={POWER_PLOT_H} />
        <polyline
          points={polylinePoints(
            samples.map((entry) => ({ x: entry.epochSecond, y: entry.powerPct })),
            powerDomain,
            size,
          )}
          fill="none"
          stroke={paletteColor("gray", shade)}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {X_FRACTIONS.map((fraction) => {
          const x = scaleX(domain.x0 + fraction * spanS, domain, PLOT_W);
          let anchor: "start" | "middle" | "end" = "middle";
          if (fraction === 0) {
            anchor = "start";
          } else if (fraction === 1) {
            anchor = "end";
          }
          return (
            <text
              key={fraction}
              x={x}
              y={POWER_PLOT_H + LABEL_SIZE + 6}
              textAnchor={anchor}
              fontSize={LABEL_SIZE}
              fill="var(--mantine-color-dimmed)"
            >
              {formatHhMm(clockSecond(startSecondOfDay, domain.x0 + fraction * spanS))}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

function LegendLine({ color, dashed }: Readonly<{ color: string; dashed?: boolean }>) {
  return (
    <Box aria-hidden w={16} style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
  );
}

function Legend({ rooms, shade }: Readonly<{ rooms: readonly HouseRoom[]; shade: number }>) {
  const entries = [
    ...rooms.map((room, index) => ({
      key: room.id,
      label: room.name,
      color: roomColor(index, shade),
      dashed: false,
    })),
    { key: "th1", label: "TH1", color: paletteColor("orange", shade), dashed: true },
    { key: "th2", label: "TH2", color: paletteColor("red", shade), dashed: true },
  ];

  return (
    <Group gap="md" wrap="wrap">
      {entries.map((entry) => (
        <Group key={entry.key} gap={6} wrap="nowrap">
          <LegendLine color={entry.color} dashed={entry.dashed} />
          <Text size="xs">{entry.label}</Text>
        </Group>
      ))}
    </Group>
  );
}

export function ChartStrip({ controls }: Readonly<{ controls: SimulationControls }>) {
  const { history, house, snapshot, startSecondOfDay, engineParams } = controls;
  const [windowS, setWindowS] = useState(DEFAULT_WINDOW_S);
  const shade = useComputedColorScheme("light") === "dark" ? 4 : 6;

  const now = snapshot.epochSecond;
  const inWindow = windowSamples(history, now, windowS);
  const samples = thinSamples(inWindow, MAX_LINE_POINTS);
  const domain: Domain = {
    x0: now - windowS,
    x1: now,
    y0: CO2_AXIS_MIN_PPM,
    y1: co2YMax(inWindow),
  };

  return (
    <Paper withBorder p="md">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>CO2 (ppm) a výkon rekuperace (%)</Text>
          <SegmentedControl
            size="xs"
            data={WINDOWS}
            value={String(windowS)}
            onChange={(value) => setWindowS(Number(value))}
          />
        </Group>
        <Legend rooms={house.rooms} shade={shade} />
        <Co2Chart
          domain={domain}
          samples={samples}
          shade={shade}
          rooms={house.rooms}
          th1={engineParams.th1}
          th2={engineParams.th2}
        />
        <PowerChart
          domain={domain}
          samples={samples}
          shade={shade}
          startSecondOfDay={startSecondOfDay}
        />
      </Stack>
    </Paper>
  );
}
