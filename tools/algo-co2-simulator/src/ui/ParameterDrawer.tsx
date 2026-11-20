import {
  Alert,
  Button,
  Drawer,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { TimePicker } from "@mantine/dates";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { valveOpening } from "../core/airflow.ts";
import { engineDefaults } from "../core/engineParams.ts";
import type { EngineParams } from "../core/engineParams.ts";
import { DEFAULT_SIM_SETTINGS } from "../core/settings.ts";
import type { SimSettings } from "../core/settings.ts";
import { formatHhMm, parseHhMm } from "./format.ts";
import { sanitizeEngineParams, sanitizeSettings } from "./params.ts";
import type { SimulationControls } from "./useSimulation.ts";

/** The engine's power scale is 0–10. */
const MAX_POWER = 10;
const PERCENT = 100;
const HH_MM_LENGTH = 5;
/** Two fields side by side need about 190 px each; a phone-wide drawer gets one column. */
const GRID_COLS = { base: 1, "380px": 2 };

interface NumberFieldProps {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimalScale?: number;
  description?: ReactNode;
}

/**
 * Shows what the user is typing while the field has focus and the applied value otherwise, so a
 * clamped value (TH2 forced above TH1, say) never rewrites the field under the user's fingers.
 * Typed text is applied on blur or Enter only: "300" must not pass through 3 and 30 on its way into
 * a running simulation. A click on a stepper arrow is a finished edit and applies at once. The
 * sanitizers behind `onCommit` are the safety net.
 */
function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step,
  decimalScale,
  description,
}: Readonly<NumberFieldProps>) {
  const [draft, setDraft] = useState<number | string | null>(null);
  // Mantine clamps the text on blur and reports it just before `onBlur` runs, so the state of the
  // blur handler's render is already stale; the ref always holds the latest edit.
  const latest = useRef<number | string | null>(null);

  function edit(next: number | string): void {
    latest.current = next;
    setDraft(next);
  }

  function apply(): void {
    const pending = latest.current;
    latest.current = null;
    setDraft(null);
    if (typeof pending === "number") {
      onCommit(pending);
    }
  }

  function applyStep(source: string): void {
    // Mantine reports its stepper arrows and the arrow keys as "increment" and "decrement".
    if (source === "increment" || source === "decrement") {
      apply();
    }
  }

  return (
    <NumberInput
      label={label}
      description={description}
      value={draft ?? value}
      onChange={edit}
      onValueChange={(_values, info) => applyStep(info.source)}
      onKeyDown={onEnter(apply)}
      onBlur={apply}
      min={min}
      max={max}
      step={step}
      decimalScale={decimalScale}
      allowNegative={false}
    />
  );
}

/** A key handler that calls `apply` when Enter is pressed. */
function onEnter(apply: () => void): (event: KeyboardEvent<HTMLInputElement>) => void {
  return function handleKeyDown(event) {
    if (event.key === "Enter") {
      apply();
    }
  };
}

interface TimeFieldProps {
  label: string;
  secondOfDay: number;
  onCommit: (secondOfDay: number) => void;
}

/**
 * A time of day in whole minutes, always shown as 24 h. The picker reports a time only once both
 * parts are filled in, so it is applied at once.
 */
function TimeField({ label, secondOfDay, onCommit }: Readonly<TimeFieldProps>) {
  function onChange(text: string): void {
    const parsed = parseHhMm(text.slice(0, HH_MM_LENGTH));
    if (parsed !== null && parsed !== secondOfDay) {
      onCommit(parsed);
    }
  }

  return (
    <TimePicker
      label={label}
      format="24h"
      value={formatHhMm(secondOfDay)}
      onChange={onChange}
      hoursInputLabel={`${label}, hodiny`}
      minutesInputLabel={`${label}, minuty`}
    />
  );
}

/** The half-closed share is stored as a fraction and edited in percent, without float noise. */
function shareToPercent(share: number): number {
  return Math.round(share * PERCENT * PERCENT) / PERCENT;
}

interface ParameterDrawerProps {
  opened: boolean;
  /** Beside the page on a wide screen; over the page, from the top of the screen, on a narrow one. */
  docked: boolean;
  /** The drawer's width in px; the page reserves the same space while it is docked and open. */
  width: number;
  /** Where a docked drawer starts, as a CSS length: below the top bar, which stays in reach. */
  top: string;
  onClose: () => void;
  controls: SimulationControls;
}

export function ParameterDrawer({
  opened,
  docked,
  width,
  top,
  onClose,
  controls,
}: Readonly<ParameterDrawerProps>) {
  const { engineParams, settings, parameterProblems } = controls;

  function changeEngine(changes: Partial<EngineParams>): void {
    controls.setEngineParams(sanitizeEngineParams({ ...engineParams, ...changes }));
  }

  function changeSettings(changes: Partial<SimSettings>): void {
    controls.setSettings(sanitizeSettings({ ...settings, ...changes }));
  }

  function changeCo2PerPerson(activity: keyof SimSettings["co2PerPersonLph"], value: number): void {
    changeSettings({ co2PerPersonLph: { ...settings.co2PerPersonLph, [activity]: value } });
  }

  function restoreDefaults(): void {
    controls.setEngineParams(sanitizeEngineParams(engineDefaults()));
    controls.setSettings(sanitizeSettings(DEFAULT_SIM_SETTINGS));
  }

  const partialFlowPct = Math.round(
    valveOpening(
      engineParams.partialCloseValue,
      settings.valveFullyClosedPosition,
      settings.valveHalfClosedFlowShare,
    ) * PERCENT,
  );

  // No overlay and no focus trap: parameters are meant to be changed while a run plays, and the top
  // bar and the page beside the drawer (which the page makes room for) stay usable.
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size={docked ? width : `min(${width}px, 100%)`}
      title="Parametry"
      withOverlay={false}
      trapFocus={false}
      lockScroll={false}
      styles={{ inner: { top: docked ? top : 0 }, content: { height: "100%" } }}
    >
      <Stack gap="lg">
        <Stack gap="xs">
          <Button variant="default" onClick={restoreDefaults} style={{ alignSelf: "flex-start" }}>
            Obnovit výchozí
          </Button>
          <Text size="xs" c="dimmed">
            Hodnota se použije po opuštění pole nebo Enter.
          </Text>
        </Stack>

        {parameterProblems.length > 0 && (
          <Alert color="orange" title="Algoritmus hlásí chybné parametry">
            <Stack gap={4}>
              {parameterProblems.map((problem) => (
                <Text key={problem} size="sm">
                  {problem}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        <Stack gap="sm">
          <Title order={5}>Algoritmus</Title>
          <SimpleGrid type="container" cols={GRID_COLS} spacing="sm" verticalSpacing="sm">
            <NumberField
              label="TH1 (ppm)"
              value={engineParams.th1}
              onCommit={(th1) => changeEngine({ th1 })}
              min={0}
              step={50}
            />
            <NumberField
              label="TH2 (ppm)"
              value={engineParams.th2}
              onCommit={(th2) => changeEngine({ th2 })}
              min={engineParams.th1 + 1}
              step={50}
            />
            <NumberField
              label="TH1diff – hystereze TH1 (ppm)"
              value={engineParams.th1Hysteresis}
              onCommit={(th1Hysteresis) => changeEngine({ th1Hysteresis })}
              min={0}
              step={10}
            />
            <NumberField
              label="TH2diff – hystereze TH2 (ppm)"
              value={engineParams.th2Hysteresis}
              onCommit={(th2Hysteresis) => changeEngine({ th2Hysteresis })}
              min={0}
              step={10}
            />
            <NumberField
              label="Tzone – čas nad prahem (s)"
              value={engineParams.thresholdTimeLimit}
              onCommit={(thresholdTimeLimit) => changeEngine({ thresholdTimeLimit })}
              min={0}
              step={10}
            />
            <NumberField
              label="Topen – čas pod prahem (s)"
              value={engineParams.belowTimeLimit}
              onCommit={(belowTimeLimit) => changeEngine({ belowTimeLimit })}
              min={0}
              step={10}
            />
            <NumberField
              label="Filtr CO2 α za sekundu (0,01–1)"
              value={engineParams.co2FilterAlpha}
              onCommit={(co2FilterAlpha) => changeEngine({ co2FilterAlpha })}
              min={0.01}
              max={1}
              step={0.05}
              decimalScale={2}
            />
            <NumberField
              label="Minimální výkon rekuperace (0–10)"
              value={engineParams.hruMinPower}
              onCommit={(hruMinPower) => changeEngine({ hruMinPower })}
              min={0}
              max={MAX_POWER}
              step={0.5}
              decimalScale={2}
            />
            <NumberField
              label="Maximální výkon ve dne (0–10)"
              value={engineParams.hruMaxPowerDay}
              onCommit={(hruMaxPowerDay) => changeEngine({ hruMaxPowerDay })}
              min={engineParams.hruMinPower}
              max={MAX_POWER}
              step={0.5}
              decimalScale={2}
            />
            <NumberField
              label="Maximální výkon v noci (0–10)"
              value={engineParams.hruMaxPowerNight}
              onCommit={(hruMaxPowerNight) => changeEngine({ hruMaxPowerNight })}
              min={engineParams.hruMinPower}
              max={MAX_POWER}
              step={0.5}
              decimalScale={2}
            />
            <NumberField
              label="Krok výkonu (0–10)"
              value={engineParams.hruPowerStep}
              onCommit={(hruPowerStep) => changeEngine({ hruPowerStep })}
              min={0.01}
              step={0.5}
              decimalScale={2}
            />
            <NumberField
              label="Interval snižování výkonu (s)"
              value={engineParams.hruPowerStepDownInterval}
              onCommit={(hruPowerStepDownInterval) => changeEngine({ hruPowerStepDownInterval })}
              min={0.01}
              step={10}
              decimalScale={2}
            />
            <NumberField
              label="Interval kontroly výkonu (s)"
              description="Jak často se nad TH1 posuzuje, zda přidat výkon"
              value={engineParams.powerReviewInterval}
              onCommit={(powerReviewInterval) => changeEngine({ powerReviewInterval })}
              min={1}
              step={60}
            />
            <NumberField
              label="Pokles CO2 pro podržení výkonu (ppm)"
              description="O kolik musí průměr mezi kontrolami klesnout, aby se výkon nepřidal"
              value={engineParams.co2FallingMargin}
              onCommit={(co2FallingMargin) => changeEngine({ co2FallingMargin })}
              min={0}
              step={5}
            />
            <NumberField
              label="Nejvíc kroků výkonu po sobě"
              description="Pojistka pro místnost, která na výkon nereaguje"
              value={engineParams.powerReviewStepLimit}
              onCommit={(powerReviewStepLimit) => changeEngine({ powerReviewStepLimit })}
              min={1}
              step={1}
            />
            <NumberField
              label="Držení při výpadku čidla (s)"
              description="Jak dlouho místnost nad TH1 bez hodnot drží výkon"
              value={engineParams.missingReadingHold}
              onCommit={(missingReadingHold) => changeEngine({ missingReadingHold })}
              min={0}
              step={600}
            />
            <Switch
              label="Pohyb osob (Fluctuation)"
              checked={engineParams.fluctuationEnabled}
              onChange={(event) =>
                changeEngine({ fluctuationEnabled: event.currentTarget.checked })
              }
              style={{ alignSelf: "end", paddingBottom: "var(--mantine-spacing-xs)" }}
            />
            <NumberField
              label="Výkon při pohybu osob (0–10)"
              value={engineParams.hruMovePower}
              onCommit={(hruMovePower) => changeEngine({ hruMovePower })}
              min={engineParams.hruMinPower}
              max={MAX_POWER}
              step={0.5}
              decimalScale={2}
            />
            <NumberField
              label="Pohyb osob od TH1 − (ppm)"
              value={engineParams.fluctuationOffset}
              onCommit={(fluctuationOffset) => changeEngine({ fluctuationOffset })}
              min={0}
              step={10}
              description={`Hranice ${engineParams.th1 - engineParams.fluctuationOffset} ppm`}
            />
            <NumberField
              label="Poloha při částečném zavření"
              value={engineParams.partialCloseValue}
              onCommit={(partialCloseValue) => changeEngine({ partialCloseValue })}
              min={0}
              step={5}
            />
            <NumberField
              label="Poloha při plném otevření"
              value={engineParams.fullyOpenValue}
              onCommit={(fullyOpenValue) => changeEngine({ fullyOpenValue })}
              min={0}
              step={5}
            />
            <TimeField
              label="Začátek dne"
              secondOfDay={engineParams.dayStart}
              onCommit={(dayStart) => changeEngine({ dayStart })}
            />
            <TimeField
              label="Konec dne"
              secondOfDay={engineParams.dayEnd}
              onCommit={(dayEnd) => changeEngine({ dayEnd })}
            />
          </SimpleGrid>
        </Stack>

        <Stack gap="sm">
          <Title order={5}>Simulace</Title>
          <SimpleGrid type="container" cols={GRID_COLS} spacing="sm" verticalSpacing="sm">
            <NumberField
              label="Perioda algoritmu (s)"
              value={settings.enginePeriodS}
              onCommit={(enginePeriodS) => changeSettings({ enginePeriodS })}
              min={1}
              step={1}
              decimalScale={0}
            />
            <NumberField
              label="Interval čidel (s)"
              value={settings.sensorIntervalS}
              onCommit={(sensorIntervalS) => changeSettings({ sensorIntervalS })}
              min={1}
              step={1}
              decimalScale={0}
            />
            <Switch
              label="Šum čidel"
              checked={settings.sensorNoise}
              onChange={(event) => changeSettings({ sensorNoise: event.currentTarget.checked })}
              style={{ alignSelf: "end", paddingBottom: "var(--mantine-spacing-xs)" }}
            />
            <NumberField
              label="Šum čidel σ (ppm)"
              value={settings.sensorNoiseSigmaPpm}
              onCommit={(sensorNoiseSigmaPpm) => changeSettings({ sensorNoiseSigmaPpm })}
              min={0}
              step={5}
            />
            <NumberField
              label="Seed šumu"
              description="Stejné číslo dá stejný šum; použije se od příštího Resetu"
              value={settings.noiseSeed}
              onCommit={(noiseSeed) => changeSettings({ noiseSeed })}
              min={0}
              step={1}
              decimalScale={0}
            />
            <NumberField
              label="CO2 venku (ppm)"
              value={settings.outdoorCo2Ppm}
              onCommit={(outdoorCo2Ppm) => changeSettings({ outdoorCo2Ppm })}
              min={0}
              step={10}
            />
            <NumberField
              label="Infiltrace (ACH, 1/h)"
              value={settings.infiltrationAch}
              onCommit={(infiltrationAch) => changeSettings({ infiltrationAch })}
              min={0}
              step={0.05}
              decimalScale={2}
            />
            <NumberField
              label="CO2 spící osoby (l/h)"
              value={settings.co2PerPersonLph.sleeping}
              onCommit={(value) => changeCo2PerPerson("sleeping", value)}
              min={0}
              step={1}
            />
            <NumberField
              label="CO2 sedící osoby (l/h)"
              value={settings.co2PerPersonLph.sitting}
              onCommit={(value) => changeCo2PerPerson("sitting", value)}
              min={0}
              step={1}
            />
            <NumberField
              label="CO2 aktivní osoby (l/h)"
              value={settings.co2PerPersonLph.active}
              onCommit={(value) => changeCo2PerPerson("active", value)}
              min={0}
              step={1}
            />
            <NumberField
              label="Poloha plně zavřeného ventilu"
              value={settings.valveFullyClosedPosition}
              onCommit={(valveFullyClosedPosition) => changeSettings({ valveFullyClosedPosition })}
              min={1}
              step={5}
            />
            <NumberField
              label="Průtok ventilu při polovičním zavření (%)"
              value={shareToPercent(settings.valveHalfClosedFlowShare)}
              onCommit={(percent) =>
                changeSettings({ valveHalfClosedFlowShare: percent / PERCENT })
              }
              min={1}
              max={PERCENT}
              step={5}
              decimalScale={2}
              description={`Poloha ${engineParams.partialCloseValue} propustí ${partialFlowPct} %`}
            />
          </SimpleGrid>
        </Stack>
      </Stack>
    </Drawer>
  );
}
