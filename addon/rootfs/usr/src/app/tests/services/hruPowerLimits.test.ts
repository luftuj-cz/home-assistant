import { describe, expect, it } from "vitest";
import {
  getEffectiveMax,
  getEffectiveMin,
  HruService,
} from "../../src/features/hru/hru.service.js";
import type { HruVariable } from "../../src/features/hru/hru.definitions.js";
import type { HruRepository } from "../../src/features/hru/hru.repository.js";
import type { SettingsRepository } from "../../src/features/settings/settings.repository.js";
import type { HruSettings } from "../../src/types/index.js";
import type { Logger } from "pino";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

function createService(settings: HruSettings | null): HruService {
  const settingsRepo = { getHruSettings: () => settings } as unknown as SettingsRepository;
  return new HruService({} as HruRepository, settingsRepo, noopLogger);
}

const POWER: HruVariable = {
  name: "power",
  type: "number",
  editable: true,
  label: "power",
  class: "power",
  min: 80,
  max: 400,
};

describe("effective power limits", () => {
  it("ignores user limits when the variable is not configurable", () => {
    const settings = { minPower: 120, maxPower: 300 };
    expect(getEffectiveMin(POWER, settings)).toBe(80);
    expect(getEffectiveMax(POWER, settings)).toBe(400);
  });

  it("uses the user's limits when the variable is configurable", () => {
    const variable = { ...POWER, minConfigurable: true, maxConfigurable: true };
    const settings = { minPower: 120, maxPower: 300 };
    expect(getEffectiveMin(variable, settings)).toBe(120);
    expect(getEffectiveMax(variable, settings)).toBe(300);
  });

  it("falls back to minDefault, then min, when no minPower is stored", () => {
    const variable = { ...POWER, minConfigurable: true };
    expect(getEffectiveMin({ ...variable, minDefault: 100 }, {})).toBe(100);
    expect(getEffectiveMin(variable, null)).toBe(80);
  });
});

describe("HruService write validation with minConfigurable", () => {
  const settings: HruSettings = {
    unit: "sp-sabik",
    host: "localhost",
    port: 502,
    unitId: 1,
    minPower: 120,
    maxPower: 300,
  };

  it("rejects power below the configured minimum", () => {
    const service = createService(settings);
    expect(() => service.validateWriteValues({ power: 100 })).toThrow(/at least 120/);
  });

  it("rejects power above the configured maximum", () => {
    const service = createService(settings);
    expect(() => service.validateWriteValues({ power: 350 })).toThrow(/at most 300/);
  });

  it("accepts power within the configured range", () => {
    const service = createService(settings);
    expect(() => service.validateWriteValues({ power: 200 })).not.toThrow();
  });
});
