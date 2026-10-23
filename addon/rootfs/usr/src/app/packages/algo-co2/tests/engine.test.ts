import { describe, expect, test } from "vitest";

import { Box, Building, Room, Sensor, Valve, ValveType } from "../src/model.js";
import { AutomaticModeEngine, Timestamp, type HRU, type Logger } from "../src/engine.js";
import { SensorSimulator, SimulatedHRU } from "./simulator.js";

const logger: Logger = {
  info() {
    // The scenarios assert on the journal; log lines would only add noise.
  },
};

const sensorObyvak = new Sensor("sensor_obyvak");
const sensorLoznice = new Sensor("sensor_loznice");
const sensorPracovna = new Sensor("sensor_pracovna");

const roomObyvak = new Room("obyvak", [sensorObyvak]);
const roomLoznice = new Room("loznice", [sensorLoznice]);
const roomPracovna = new Room("pracovna", [sensorPracovna]);

const valveObyvak1 = new Valve("obyvak_privod_1", 0, roomObyvak, ValveType.Supply);
const valveObyvak2 = new Valve("obyvak_privod_2", 0, roomObyvak, ValveType.Supply);
const valveLoznice1 = new Valve("loznice_privod_1", 0, roomLoznice, ValveType.Supply);
const valveLoznice2 = new Valve("loznice_privod_2", 0, roomLoznice, ValveType.Supply);
const valvePracovna = new Valve("pracovna_privod", 0, roomPracovna, ValveType.Supply);

const model: Building = new Building(
  [roomObyvak, roomPracovna, roomLoznice],
  [new Box([valveObyvak1, valveObyvak2, valveLoznice1, valveLoznice2, valvePracovna])],
);

function createEngine(): AutomaticModeEngine {
  valveObyvak1.value = 0;
  valveObyvak2.value = 0;
  valveLoznice1.value = 0;
  valveLoznice2.value = 0;
  valvePracovna.value = 0;
  const hru: HRU = new SimulatedHRU(20);
  return new AutomaticModeEngine(model, hru, logger);
}

function simulate(
  startHour: number,
  secondsToSimulate: number,
  simulators: SensorSimulator[],
): string {
  const engine = createEngine();
  engine.clearJournal();
  engine.useJournal = true;
  for (let time = 0; time <= secondsToSimulate; time++) {
    for (const simulator of simulators) {
      simulator.updateSensor(time);
    }
    engine.run(Timestamp.simulate(time, startHour));
  }
  return engine.getJournalString();
}

describe("sada testu na automaticke rizeni rekuperace", () => {
  test("noc", () => {
    const simObyvak = new SensorSimulator(sensorObyvak).addPoint(0, 600);
    const simLoznice = new SensorSimulator(sensorLoznice).addPoint(0, 800).addPoint(300, 1202);
    const simPracovna = new SensorSimulator(sensorPracovna).addPoint(0, 900);
    const res = simulate(22, 1000, [simObyvak, simLoznice, simPracovna]);
    expect(res).toBe(
      "120,20,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;480,30,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;600,40,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;720,50,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0",
    );
  });

  test("noc - clovek v pracovne", () => {
    const simObyvak = new SensorSimulator(sensorObyvak).addPoint(0, 600);
    const simLoznice = new SensorSimulator(sensorLoznice).addPoint(0, 800).addPoint(300, 1202);
    const simPracovna = new SensorSimulator(sensorPracovna)
      .addPoint(0, 900)
      .addPoint(550, 900)
      .addPoint(551, 500)
      .addPoint(670, 500)
      .addPoint(671, 900);

    const res = simulate(22, 1000, [simObyvak, simLoznice, simPracovna]);
    expect(res).toBe(
      "120,20,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;480,30,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0;552,30,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:45;600,40,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:45;720,50,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:45;794,50,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0",
    );
  });

  test("pracovna", () => {
    const simObyvak = new SensorSimulator(sensorObyvak).addPoint(0, 600);
    const simLoznice = new SensorSimulator(sensorLoznice).addPoint(0, 600);
    const simPracovna = new SensorSimulator(sensorPracovna)
      .addPoint(0, 600)
      .addPoint(200, 900)
      .addPoint(400, 1050)
      .addPoint(600, 700);
    const res = simulate(8, 1000, [simObyvak, simLoznice, simPracovna]);
    expect(res).toBe(
      "256,20,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:45,loznice_privod_2:45,pracovna_privod:0;694,20,obyvak_privod_1:0,obyvak_privod_2:0,loznice_privod_1:0,loznice_privod_2:0,pracovna_privod:0",
    );
  });

  test("fluktuace", () => {
    const simObyvak = new SensorSimulator(sensorObyvak).addPoint(0, 600);
    const simLoznice = new SensorSimulator(sensorLoznice).addPoint(0, 600);
    const simPracovna = new SensorSimulator(sensorPracovna)
      .addPoint(0, 600)
      .addPoint(120, 900)
      .addPoint(130, 700)
      .addPoint(140, 900)
      .addPoint(150, 700)
      .addPoint(160, 900)
      .addPoint(170, 700)
      .addPoint(180, 900);
    const res = simulate(8, 1000, [simObyvak, simLoznice, simPracovna]);
    expect(res).toBe(
      "297,20,obyvak_privod_1:45,obyvak_privod_2:45,loznice_privod_1:45,loznice_privod_2:45,pracovna_privod:0",
    );
  });

  test("rozbite cidlo", () => {
    sensorObyvak.co2 = null;
    const simLoznice = new SensorSimulator(sensorLoznice).addPoint(0, 600);
    const simPracovna = new SensorSimulator(sensorPracovna).addPoint(0, 600).addPoint(200, 1500);
    const res = simulate(8, 300, [simLoznice, simPracovna]);
    expect(res).toBe(
      "167,20,obyvak_privod_1:0,obyvak_privod_2:0,loznice_privod_1:45,loznice_privod_2:45,pracovna_privod:0;287,30,obyvak_privod_1:0,obyvak_privod_2:0,loznice_privod_1:45,loznice_privod_2:45,pracovna_privod:0",
    );
  });
});
