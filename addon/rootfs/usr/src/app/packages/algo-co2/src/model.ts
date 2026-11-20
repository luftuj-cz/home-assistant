export class Building {
  constructor(
    private readonly _rooms: Room[],
    private readonly _boxes: Box[],
  ) {}

  get rooms(): Room[] {
    return this._rooms;
  }

  get boxes(): Box[] {
    return this._boxes;
  }

  getAllValves(): Valve[] {
    return this._boxes.flatMap((box) => box.valves);
  }
}

export class Room {
  constructor(
    private readonly _id: string,
    private readonly _sensors: Sensor[],
  ) {}

  get id(): string {
    return this._id;
  }

  get sensors(): Sensor[] {
    return this._sensors;
  }

  /** The maximum over the sensors that hold a reading, or `null` when none does. */
  getCO2(): number | null {
    const readings = this._sensors.map((s) => s.co2).filter(isReading);
    if (readings.length === 0) return null;
    return readings.reduce((max, co2) => Math.max(co2, max), 0);
  }
}

/**
 * A finite number above 0. `unknown` on purpose: a caller can hand over `NaN`, `undefined` or a
 * string despite the declared type, and one such value used to turn the room's filter into `NaN`
 * for good.
 */
function isReading(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export class Box {
  constructor(private readonly _valves: Valve[]) {}

  get valves(): Valve[] {
    return this._valves;
  }
}

export enum ValveType {
  Supply,
  Exhaust,
}

export class Sensor {
  /** `null` until the caller writes a reading. */
  co2: number | null = null;
  constructor(private readonly _id: string) {}

  get id(): string {
    return this._id;
  }
}

export class Valve {
  value: number = 0;
  constructor(
    private readonly _id: string,
    private readonly _defaultValue: number,
    private readonly _room: Room,
    private readonly _type: ValveType,
  ) {}

  get id(): string {
    return this._id;
  }

  get defaultValue(): number {
    return this._defaultValue;
  }

  get room(): Room {
    return this._room;
  }

  get type(): ValveType {
    return this._type;
  }

  resetToDefault(): void {
    this.value = this._defaultValue;
  }
}
