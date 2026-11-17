import { describe, expect, test } from "vitest";

import { hruFlowM3h, splitValveFlows, valveOpening } from "./airflow.ts";

describe("valveOpening", () => {
  test("passes full flow open and nothing closed", () => {
    expect(valveOpening(0, 90, 0.25)).toBe(1);
    expect(valveOpening(90, 90, 0.25)).toBe(0);
    expect(valveOpening(120, 90, 0.25)).toBe(0);
  });

  test("passes the configured share at half-closed", () => {
    expect(valveOpening(45, 90, 0.25)).toBeCloseTo(0.25, 10);
    expect(valveOpening(45, 90, 0.5)).toBeCloseTo(0.5, 10);
    expect(valveOpening(30, 90, 0.5)).toBeCloseTo(2 / 3, 10);
  });
});

describe("splitValveFlows", () => {
  test("redirects air to open valves at constant total", () => {
    const flows = splitValveFlows(
      [
        { id: "a", type: "supply", position: 0 },
        { id: "b", type: "supply", position: 45 },
        { id: "c", type: "supply", position: 45 },
      ],
      300,
      90,
      0.25,
    );

    expect(flows.get("a")).toBeCloseTo(200, 8);
    expect(flows.get("b")).toBeCloseTo(50, 8);
    expect(flows.get("c")).toBeCloseTo(50, 8);
    const sum = [...flows.values()].reduce((total, flow) => total + flow, 0);
    expect(sum).toBeCloseTo(300, 8);
  });

  test("splits supply and exhaust separately", () => {
    const flows = splitValveFlows(
      [
        { id: "in", type: "supply", position: 0 },
        { id: "out", type: "exhaust", position: 0 },
      ],
      300,
      90,
      0.25,
    );

    expect(flows.get("in")).toBe(300);
    expect(flows.get("out")).toBe(300);
  });

  test("gives nothing when every valve of a type is closed", () => {
    const flows = splitValveFlows([{ id: "in", type: "supply", position: 90 }], 300, 90, 0.25);

    expect(flows.get("in")).toBe(0);
  });
});

describe("hruFlowM3h", () => {
  test("scales nominal flow by power", () => {
    expect(hruFlowM3h(300, 4)).toBeCloseTo(120, 10);
  });
});
