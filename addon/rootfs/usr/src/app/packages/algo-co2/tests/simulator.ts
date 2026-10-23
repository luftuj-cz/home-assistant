import type { HRU } from "../src/engine.js";
import type { Sensor } from "../src/model.js";

export interface SimulatorPoint {
  time: number;
  value: number;
}

export class SensorSimulator {
  private _points: SimulatorPoint[] = [];

  constructor(private readonly _sensor: Sensor) {}

  addPoint(time: number, value: number): this {
    this._points.push({ time, value });
    this._points.sort((a, b) => a.time - b.time);
    return this;
  }

  setPoints(points: SimulatorPoint[]): this {
    this._points = [...points].sort((a, b) => a.time - b.time);
    return this;
  }

  get points(): SimulatorPoint[] {
    return this._points;
  }

  getValueAt(time: number): number | null {
    const first = this._points[0];
    const last = this._points.at(-1);
    if (first === undefined || last === undefined) {
      return this._sensor.co2;
    }

    // Before first point
    if (time <= first.time) {
      return first.value;
    }

    // After last point
    if (time >= last.time) {
      return last.value;
    }

    // Find surrounding points
    for (const [i, current] of this._points.entries()) {
      const next = this._points[i + 1];
      if (next === undefined) {
        break;
      }

      if (time >= current.time && time <= next.time) {
        // Linear interpolation
        const ratio = (time - current.time) / (next.time - current.time);
        return Math.round(current.value + ratio * (next.value - current.value));
      }
    }

    return this._sensor.co2;
  }

  updateSensor(time: number): void {
    this._sensor.co2 = this.getValueAt(time);
  }
}

export class SimulatedHRU implements HRU {
  private _power: number;

  constructor(defaultPower: number) {
    this._power = defaultPower;
  }

  public getPower(): number {
    return this._power;
  }

  public setPower(power: number): void {
    this._power = power;
  }
}
