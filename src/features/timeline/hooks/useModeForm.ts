import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { Valve } from "@luftuj/shared/types/valve";

export interface ModeFormState {
  name: string;
  setName: (v: string) => void;
  variableValues: Record<string, number | string | boolean>;
  setVariableValues: Dispatch<SetStateAction<Record<string, number | string | boolean>>>;
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
  const [variableValues, setVariableValues] = useState<Record<string, number | string | boolean>>(
    {},
  );
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
    const cleanedValveOpenings = valves.reduce(
      (acc, valve) => {
        const key = valve.entityId || valve.name;
        if (!key) return acc;
        const value = valveOpenings[key] ?? 0;
        if (!Number.isNaN(value) && value >= 0 && value <= 100) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, number>,
    );
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
