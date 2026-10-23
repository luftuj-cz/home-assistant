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

  getCO2(): number | null {
    const readings = this._sensors.map((s) => s.co2).filter((co2) => co2 !== null);
    if (readings.length === 0) return null;
    return readings.reduce((max, co2) => Math.max(co2, max), 0);
  }
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
  co2: number | null = 0;
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
