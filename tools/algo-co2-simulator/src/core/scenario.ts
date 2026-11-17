import type { Scenario, ScenarioStep } from "./house.ts";
import type { Activity } from "./settings.ts";

export interface Occupancy {
  people: number;
  activity: Activity;
}

function keepLatest(latest: Map<string, ScenarioStep>, step: ScenarioStep): void {
  const current = latest.get(step.roomId);
  if (current === undefined || step.atSecondOfDay >= current.atSecondOfDay) {
    latest.set(step.roomId, step);
  }
}

/**
 * Who is in each room at a time of day: the latest step of the room at or before it.
 * Before a room's first step of the day the last step of the day still holds, so the
 * schedule wraps across midnight. A room without steps stays empty.
 */
export function occupancyAt(
  scenario: Scenario | null,
  roomIds: readonly string[],
  secondOfDay: number,
): Map<string, Occupancy> {
  const latestBefore = new Map<string, ScenarioStep>();
  const latestOfDay = new Map<string, ScenarioStep>();
  for (const step of scenario?.steps ?? []) {
    keepLatest(latestOfDay, step);
    if (step.atSecondOfDay <= secondOfDay) {
      keepLatest(latestBefore, step);
    }
  }

  const occupancy = new Map<string, Occupancy>();
  for (const roomId of roomIds) {
    const step = latestBefore.get(roomId) ?? latestOfDay.get(roomId);
    occupancy.set(
      roomId,
      step === undefined
        ? { people: 0, activity: "sitting" }
        : { people: step.people, activity: step.activity },
    );
  }
  return occupancy;
}

export function stepsDueAt(scenario: Scenario | null, secondOfDay: number): ScenarioStep[] {
  return (scenario?.steps ?? []).filter((step) => step.atSecondOfDay === secondOfDay);
}
