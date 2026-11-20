import {
  Box,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  useComputedColorScheme,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { useId, useState } from "react";

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

type Series = "actual" | "filtered";
const SERIES: { value: Series; label: string }[] = [
  { value: "actual", label: "Skutečné" },
  { value: "filtered", label: "Vyhlazené" },
];

/** One line should not need more points than the chart has pixels; 24 h holds 8640 samples. */
const MAX_LINE_POINTS = 800;

/**
 * Drawn 1:1 in CSS pixels at the width the page gives it, so labels stay readable on a phone. The
 * minimum is also what is drawn before the first measurement.
 */
const MIN_VIEW_W = 240;
const MARGIN = { left: 44, right: 8, top: 10 };
const CO2_PLOT_H = 200;
const CO2_BOTTOM = 8;
const POWER_PLOT_H = 56;
const POWER_BOTTOM = 22;
const POWER_TICKS = [0, 5, 10];
const X_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const NARROW_X_FRACTIONS = [0, 0.5, 1];
/** Five clock labels need about this much plot width not to touch. */
const NARROW_PLOT_W = 320;
const LABEL_SIZE = 11;

/** Orange and red are left to the thresholds; the largest preset house has eleven rooms. */
const ROOM_COLORS = [
  "blue",
  "grape",
  "teal",
  "yellow",
  "indigo",
  "lime",
  "pink",
  "cyan",
  "green",
  "violet",
  "gray",
];

interface ChartProps {
  /** The whole SVG's width in px. */
  viewW: number;
  domain: Domain;
  samples: readonly HistorySample[];
  shade: number;
}

interface Co2ChartProps extends ChartProps {
  rooms: readonly HouseRoom[];
  /** The air itself, or the filtered value the engine decides by. */
  series: Series;
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

function plotWidth(viewW: number): number {
  return viewW - MARGIN.left - MARGIN.right;
}

function xFractions(plotW: number): readonly number[] {
  return plotW < NARROW_PLOT_W ? NARROW_X_FRACTIONS : X_FRACTIONS;
}

function inside(value: number, domain: Domain): boolean {
  return value >= domain.y0 && value <= domain.y1;
}

/** The faint vertical lines that tie the two charts to the same clock labels. */
function VerticalGrid({ plotW, plotH }: Readonly<{ plotW: number; plotH: number }>) {
  return xFractions(plotW).map((fraction) => (
    <line
      key={fraction}
      x1={fraction * plotW}
      x2={fraction * plotW}
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
  plotW,
  plotH,
}: Readonly<{ ticks: readonly number[]; domain: Domain; plotW: number; plotH: number }>) {
  return ticks.map((tick) => {
    const y = scaleY(tick, domain, plotH);
    return (
      <g key={tick}>
        <line
          x1={0}
          x2={plotW}
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

function Co2Chart({
  viewW,
  domain,
  samples,
  shade,
  rooms,
  series,
  th1,
  th2,
}: Readonly<Co2ChartProps>) {
  const plotW = plotWidth(viewW);
  const size = { w: plotW, h: CO2_PLOT_H };
  const clipId = useId();
  const viewH = viewHeight(CO2_PLOT_H, CO2_BOTTOM);
  const thresholds = [
    { label: "TH1", value: th1, color: paletteColor("orange", shade) },
    { label: "TH2", value: th2, color: paletteColor("red", shade) },
  ].filter((threshold) => inside(threshold.value, domain));

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      width={viewW}
      height={viewH}
      role="img"
      aria-label="Průběh CO2 v místnostech a prahy TH1 a TH2"
      style={{ display: "block" }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={plotW} height={CO2_PLOT_H} />
        </clipPath>
      </defs>
      <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
        <VerticalGrid plotW={plotW} plotH={CO2_PLOT_H} />
        <HorizontalGrid
          ticks={yTicks(domain.y0, domain.y1)}
          domain={domain}
          plotW={plotW}
          plotH={CO2_PLOT_H}
        />
        {rooms.map((room, index) => (
          <polyline
            key={room.id}
            clipPath={`url(#${clipId})`}
            points={polylinePoints(
              samples.flatMap((entry) => {
                const y =
                  series === "filtered" ? entry.filteredCo2Ppm[room.id] : entry.co2Ppm[room.id];
                return y === undefined || y === null ? [] : [{ x: entry.epochSecond, y }];
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
                x2={plotW}
                y1={y}
                y2={y}
                stroke={threshold.color}
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={plotW - 4}
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

function PowerChart({
  viewW,
  domain,
  samples,
  shade,
  startSecondOfDay,
}: Readonly<PowerChartProps>) {
  const plotW = plotWidth(viewW);
  const size = { w: plotW, h: POWER_PLOT_H };
  const viewH = viewHeight(POWER_PLOT_H, POWER_BOTTOM);
  const powerDomain: Domain = { ...domain, y0: 0, y1: 10 };
  const spanS = domain.x1 - domain.x0;

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      width={viewW}
      height={viewH}
      role="img"
      aria-label="Výkon rekuperace"
      style={{ display: "block" }}
    >
      <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
        <VerticalGrid plotW={plotW} plotH={POWER_PLOT_H} />
        <HorizontalGrid
          ticks={POWER_TICKS}
          domain={powerDomain}
          plotW={plotW}
          plotH={POWER_PLOT_H}
        />
        <polyline
          points={polylinePoints(
            samples.map((entry) => ({ x: entry.epochSecond, y: entry.power })),
            powerDomain,
            size,
          )}
          fill="none"
          stroke={paletteColor("gray", shade)}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {xFractions(plotW).map((fraction) => {
          const x = scaleX(domain.x0 + fraction * spanS, domain, plotW);
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
  const [series, setSeries] = useState<Series>("actual");
  const shade = useComputedColorScheme("light") === "dark" ? 4 : 6;
  const { ref: chartsRef, width: measuredW } = useElementSize();
  const viewW = Math.max(MIN_VIEW_W, Math.floor(measuredW));

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
        <Group justify="space-between" gap="xs">
          <Text fw={600}>CO2 (ppm) a výkon rekuperace (0–10)</Text>
          <Group gap="xs">
            <SegmentedControl
              size="xs"
              aria-label="Zobrazené CO2"
              data={SERIES}
              value={series}
              onChange={(value) => setSeries(value as Series)}
            />
            <SegmentedControl
              size="xs"
              aria-label="Časové okno grafu"
              data={WINDOWS}
              value={String(windowS)}
              onChange={(value) => setWindowS(Number(value))}
            />
          </Group>
        </Group>
        <Legend rooms={house.rooms} shade={shade} />
        <Box ref={chartsRef} style={{ minWidth: 0, overflow: "hidden" }}>
          <Stack gap="xs">
            <Co2Chart
              viewW={viewW}
              domain={domain}
              samples={samples}
              shade={shade}
              rooms={house.rooms}
              series={series}
              th1={engineParams.th1}
              th2={engineParams.th2}
            />
            <PowerChart
              viewW={viewW}
              domain={domain}
              samples={samples}
              shade={shade}
              startSecondOfDay={startSecondOfDay}
            />
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
