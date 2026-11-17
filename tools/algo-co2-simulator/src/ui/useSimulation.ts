import { useEffect, useRef, useState } from "react";

import { engineDefaults } from "../core/engineParams.ts";
import type { EngineParams } from "../core/engineParams.ts";
import type { House } from "../core/house.ts";
import { PRESET_HOUSES } from "../core/presets.ts";
import type { Occupancy } from "../core/scenario.ts";
import { Simulation } from "../core/simulation.ts";
import type { HistorySample, LogEntry, SimSnapshot } from "../core/simulation.ts";
import { DEFAULT_SIM_SETTINGS } from "../core/settings.ts";
import type { SimSettings } from "../core/settings.ts";
import { stepsForFrame } from "./runLoop.ts";

const DEFAULT_START_SECOND_OF_DAY = 6 * 3600;
const DEFAULT_SPEED = 60;

export interface SimulationControls {
  houses: readonly House[];
  house: House;
  scenarioId: string | null;
  startSecondOfDay: number;
  playing: boolean;
  speed: number;
  snapshot: SimSnapshot;
  log: readonly LogEntry[];
  history: readonly HistorySample[];
  settings: SimSettings;
  engineParams: EngineParams;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  reset(): void;
  setHouse(id: string): void;
  setScenario(id: string | null): void;
  setStartSecondOfDay(secondOfDay: number): void;
  setOccupancy(roomId: string, occupancy: Occupancy): void;
  setSensorBroken(sensorId: string, broken: boolean): void;
  setSettings(settings: SimSettings): void;
  setEngineParams(params: EngineParams): void;
}

/** What a new Simulation is built from; changing any of it starts a new run. */
interface RunConfig {
  houseId: string;
  scenarioId: string | null;
  startSecondOfDay: number;
}

/** What the simulation shows at one moment, copied out of its live internals. */
interface SimView {
  snapshot: SimSnapshot;
  log: readonly LogEntry[];
  history: readonly HistorySample[];
}

function copySettings(settings: SimSettings): SimSettings {
  return { ...settings, co2PerPersonLph: { ...settings.co2PerPersonLph } };
}

function findHouse(id: string): House {
  const house = PRESET_HOUSES.find((candidate) => candidate.id === id);
  if (house === undefined) {
    throw new Error(`Unknown house ${id}`);
  }
  return house;
}

function buildSimulation(
  config: RunConfig,
  settings: SimSettings,
  engineParams: EngineParams,
): Simulation {
  const house = findHouse(config.houseId);
  return new Simulation({
    house,
    scenario: house.scenarios.find((candidate) => candidate.id === config.scenarioId) ?? null,
    startSecondOfDay: config.startSecondOfDay,
    settings,
    engineParams,
  });
}

/** The simulation's log and history are live arrays, so React only ever gets copies. */
function capture(sim: Simulation): SimView {
  return { snapshot: sim.snapshot(), log: [...sim.getLog()], history: [...sim.getHistory()] };
}

function createInitialState() {
  const config: RunConfig = {
    houseId: PRESET_HOUSES[0].id,
    scenarioId: PRESET_HOUSES[0].scenarios[0]?.id ?? null,
    startSecondOfDay: DEFAULT_START_SECOND_OF_DAY,
  };
  const settings = copySettings(DEFAULT_SIM_SETTINGS);
  const engineParams = engineDefaults();
  const sim = buildSimulation(config, settings, engineParams);
  return { config, settings, engineParams, sim, view: capture(sim) };
}

export function useSimulation(): SimulationControls {
  const [initial] = useState(createInitialState);
  const simRef = useRef(initial.sim);
  const [config, setConfig] = useState(initial.config);
  const [settings, setSettingsState] = useState(initial.settings);
  const [engineParams, setEngineParamsState] = useState(initial.engineParams);
  const [view, setView] = useState(initial.view);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState(DEFAULT_SPEED);

  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    let frame = 0;
    let lastMs = performance.now();
    let carryS = 0;

    function tick(nowMs: number): void {
      const due = stepsForFrame(nowMs - lastMs, speed, carryS);
      lastMs = nowMs;
      carryS = due.carryS;
      if (due.steps > 0) {
        simRef.current.advance(due.steps);
        setView(capture(simRef.current));
      }
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  function restart(next: RunConfig): void {
    simRef.current = buildSimulation(next, settings, engineParams);
    setConfig(next);
    setView(capture(simRef.current));
  }

  function setHouse(id: string): void {
    const house = findHouse(id);
    restart({ ...config, houseId: id, scenarioId: house.scenarios[0]?.id ?? null });
  }

  function setOccupancy(roomId: string, occupancy: Occupancy): void {
    simRef.current.setOccupancy(roomId, occupancy);
    setView(capture(simRef.current));
  }

  function setSensorBroken(sensorId: string, broken: boolean): void {
    simRef.current.setSensorBroken(sensorId, broken);
    setView(capture(simRef.current));
  }

  function setSettings(next: SimSettings): void {
    const copy = copySettings(next);
    simRef.current.setSettings(copy);
    setSettingsState(copy);
  }

  function setEngineParams(next: EngineParams): void {
    const copy = { ...next };
    simRef.current.setEngineParams(copy);
    setEngineParamsState(copy);
  }

  return {
    houses: PRESET_HOUSES,
    house: findHouse(config.houseId),
    scenarioId: config.scenarioId,
    startSecondOfDay: config.startSecondOfDay,
    playing,
    speed,
    snapshot: view.snapshot,
    log: view.log,
    history: view.history,
    settings,
    engineParams,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    setSpeed: setSpeedState,
    reset: () => restart(config),
    setHouse,
    setScenario: (id) => restart({ ...config, scenarioId: id }),
    setStartSecondOfDay: (secondOfDay) => restart({ ...config, startSecondOfDay: secondOfDay }),
    setOccupancy,
    setSensorBroken,
    setSettings,
    setEngineParams,
  };
}
