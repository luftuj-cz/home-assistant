import { describe, expect, test } from "vitest";

import { engineDefaults } from "../core/engineParams.ts";
import type { EngineParams } from "../core/engineParams.ts";
import { DEFAULT_SIM_SETTINGS } from "../core/settings.ts";
import type { SimSettings } from "../core/settings.ts";
import { sanitizeEngineParams, sanitizeSettings } from "./params.ts";

function engineWith(changes: Partial<EngineParams>): EngineParams {
  return { ...engineDefaults(), ...changes };
}

function settingsWith(changes: Partial<SimSettings>): SimSettings {
  return { ...DEFAULT_SIM_SETTINGS, ...changes };
}

describe("sanitizeEngineParams", () => {
  test("sanitizeEngineParams keeps TH2 above TH1", () => {
    expect(sanitizeEngineParams(engineWith({ th1: 1000, th2: 900 }))).toMatchObject({
      th1: 1000,
      th2: 1001,
    });
    expect(sanitizeEngineParams(engineWith({ th1: -50, th2: -100 }))).toMatchObject({
      th1: 0,
      th2: 1,
    });
  });

  test("sanitizeEngineParams clamps the filter alpha into (0, 1]", () => {
    expect(sanitizeEngineParams(engineWith({ co2FilterAlpha: 0 })).co2FilterAlpha).toBe(0.01);
    expect(sanitizeEngineParams(engineWith({ co2FilterAlpha: 2 })).co2FilterAlpha).toBe(1);
  });

  test("sanitizeEngineParams keeps both maximums at or above the minimum", () => {
    const sanitized = sanitizeEngineParams(
      engineWith({ hruMinPower: 60, hruMaxPowerDay: 40, hruMaxPowerNight: 30 }),
    );

    expect(sanitized).toMatchObject({ hruMinPower: 60, hruMaxPowerDay: 60, hruMaxPowerNight: 60 });
  });

  test("sanitizeEngineParams keeps powers within 0–100 %", () => {
    const sanitized = sanitizeEngineParams(
      engineWith({ hruMinPower: 130, hruMaxPowerDay: 150, hruMaxPowerNight: 120 }),
    );

    expect(sanitized).toMatchObject({
      hruMinPower: 100,
      hruMaxPowerDay: 100,
      hruMaxPowerNight: 100,
    });
    expect(sanitizeEngineParams(engineWith({ hruMinPower: -5 })).hruMinPower).toBe(0);
  });

  test("sanitizeEngineParams keeps the remaining parameters non-negative and the step at least 1", () => {
    const sanitized = sanitizeEngineParams(
      engineWith({
        co2Hysteresis: -1,
        thresholdTimeLimit: -1,
        hruPowerStep: 0,
        partialCloseValue: -3,
        fullyOpenValue: -3,
      }),
    );

    expect(sanitized).toMatchObject({
      co2Hysteresis: 0,
      thresholdTimeLimit: 0,
      hruPowerStep: 1,
      partialCloseValue: 0,
      fullyOpenValue: 0,
    });
  });

  test("sanitizeEngineParams keeps the day boundaries within one day", () => {
    const sanitized = sanitizeEngineParams(engineWith({ dayStart: -10, dayEnd: 90000 }));

    expect(sanitized).toMatchObject({ dayStart: 0, dayEnd: 86399 });
  });
});

describe("sanitizeSettings", () => {
  test("sanitizeSettings keeps periods at least 1 s", () => {
    expect(sanitizeSettings(settingsWith({ enginePeriodS: 0, sensorIntervalS: 0 }))).toMatchObject({
      enginePeriodS: 1,
      sensorIntervalS: 1,
    });
    expect(
      sanitizeSettings(settingsWith({ enginePeriodS: 2.5, sensorIntervalS: 30.9 })),
    ).toMatchObject({ enginePeriodS: 2, sensorIntervalS: 30 });
  });

  test("sanitizeSettings keeps the half-closed share within 1–100 %", () => {
    expect(
      sanitizeSettings(settingsWith({ valveHalfClosedFlowShare: 0 })).valveHalfClosedFlowShare,
    ).toBe(0.01);
    expect(
      sanitizeSettings(settingsWith({ valveHalfClosedFlowShare: 1.5 })).valveHalfClosedFlowShare,
    ).toBe(1);
  });

  test("sanitizeSettings keeps the physical quantities non-negative", () => {
    const sanitized = sanitizeSettings(
      settingsWith({
        sensorNoiseSigmaPpm: -1,
        outdoorCo2Ppm: -1,
        infiltrationAch: -1,
        co2PerPersonLph: { sleeping: -1, sitting: -2, active: -3 },
        valveFullyClosedPosition: 0,
      }),
    );

    expect(sanitized).toMatchObject({
      sensorNoiseSigmaPpm: 0,
      outdoorCo2Ppm: 0,
      infiltrationAch: 0,
      co2PerPersonLph: { sleeping: 0, sitting: 0, active: 0 },
      valveFullyClosedPosition: 1,
    });
  });

  test("sanitizeSettings returns its own copy of the nested record", () => {
    const sanitized = sanitizeSettings(DEFAULT_SIM_SETTINGS);

    expect(sanitized.co2PerPersonLph).not.toBe(DEFAULT_SIM_SETTINGS.co2PerPersonLph);

    sanitized.co2PerPersonLph.active = 99;

    expect(DEFAULT_SIM_SETTINGS.co2PerPersonLph.active).toBe(30);
  });
});

describe("sanitized defaults", () => {
  test("sanitized defaults are unchanged", () => {
    expect(sanitizeEngineParams(engineDefaults())).toEqual(engineDefaults());
    expect(sanitizeSettings(DEFAULT_SIM_SETTINGS)).toEqual(DEFAULT_SIM_SETTINGS);
  });
});
