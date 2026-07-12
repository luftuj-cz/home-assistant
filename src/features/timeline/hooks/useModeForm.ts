import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { Valve } from "@luftuj/shared/types/valve";

type VariableValue = number | string | boolean;

export interface ModeFormState {
  name: string;
  setName: (v: string) => void;
  variableValues: Record<string, VariableValue>;
  setVariableValues: Dispatch<SetStateAction<Record<string, VariableValue>>>;
  color: string;
  setColor: (v: string) => void;
  isBoost: boolean;
  setIsBoost: (v: boolean) => void;
  valveOpenings: Record<string, number | undefined>;
  setValveOpenings: Dispatch<SetStateAction<Record<string, number | undefined>>>;
  submitted: boolean;
  setSubmitted: (v: boolean) => void;
  getPayload: () => Omit<Partial<Mode>, "id">;
}

export function useModeForm(opened: boolean, mode: Mode | null, valves: Valve[]): ModeFormState {
  const [name, setName] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, VariableValue>>({});
  const [color, setColor] = useState("");
  const [isBoost, setIsBoost] = useState(false);
  const [valveOpenings, setValveOpenings] = useState<Record<string, number | undefined>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setSubmitted(false);
    if (mode) {
      setName(mode.name);
      setVariableValues(mode.variables || {});
      setColor(mode.color ?? "");
      setIsBoost(mode.isBoost ?? false);
      setValveOpenings(mode.luftatorConfig ?? {});
    } else {
      setName("");
      setVariableValues({});
      setColor("");
      setIsBoost(false);
      setValveOpenings({});
    }
  }, [opened, mode]);

  function getPayload(): Omit<Partial<Mode>, "id"> {
    const trimmedName = name.trim();
    // Keep entries for valves that no longer appear in the latest snapshot. They are
    // rendered as unavailable in the editor and must survive saving unrelated changes.
    const cleanedValveOpenings = Object.entries(valveOpenings).reduce(
      (acc, valve) => {
        const [key, value] = valve;
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
    for (const valve of valves) {
      const key = valve.entityId || valve.name;
      if (key && !(key in cleanedValveOpenings)) {
        cleanedValveOpenings[key] = 0;
      }
    }
    return {
      name: trimmedName,
      variables: variableValues,
      color: color || undefined,
      isBoost,
      luftatorConfig: Object.keys(cleanedValveOpenings).length ? cleanedValveOpenings : undefined,
    };
  }

  return {
    name,
    setName,
    variableValues,
    setVariableValues,
    color,
    setColor,
    isBoost,
    setIsBoost,
    valveOpenings,
    setValveOpenings,
    submitted,
    setSubmitted,
    getPayload,
  };
}
