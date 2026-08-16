import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { Valve } from "@luftuj/shared/types/valve";

type VariableValue = number | string | boolean;

// A script row carries a stable id so React keys survive add/remove without
// re-associating per-row UI state (focus, open dropdown) to the wrong row.
export interface ScriptRow {
  id: number;
  value: string | null;
}

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
  scriptRows: ScriptRow[];
  setScriptRows: Dispatch<SetStateAction<ScriptRow[]>>;
  addScript: () => void;
  removeScript: (id: number) => void;
  setScript: (id: number, value: string | null) => void;
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
  const [scriptRows, setScriptRows] = useState<ScriptRow[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const nextRowId = useRef(0);

  function makeRows(values: string[]): ScriptRow[] {
    return values.map((value) => ({ id: nextRowId.current++, value }));
  }

  useEffect(() => {
    if (!opened) return;
    setSubmitted(false);
    if (mode) {
      setName(mode.name);
      setVariableValues(mode.variables || {});
      setColor(mode.color ?? "");
      setIsBoost(mode.isBoost ?? false);
      setValveOpenings(mode.luftatorConfig ?? {});
      setScriptRows(makeRows(mode.scriptEntityIds ?? []));
    } else {
      setName("");
      setVariableValues({});
      setColor("");
      setIsBoost(false);
      setValveOpenings({});
      setScriptRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, mode]);

  function addScript(): void {
    setScriptRows((prev) => [...prev, { id: nextRowId.current++, value: null }]);
  }

  function removeScript(id: number): void {
    setScriptRows((prev) => prev.filter((row) => row.id !== id));
  }

  function setScript(id: number, value: string | null): void {
    setScriptRows((prev) => prev.map((row) => (row.id === id ? { ...row, value } : row)));
  }

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
    // Drop empty rows and duplicates; keep only valid script entity ids.
    const cleanedScripts = Array.from(
      new Set(
        scriptRows
          .map((row) => row.value)
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0),
      ),
    );

    // A mode that only runs scripts must write nothing to the hardware - "in
    // summer, open the window instead of running the unit". Defaulting every
    // valve to 0 below would turn that into "close every valve", so the
    // defaults are skipped when scripts are all that has been entered.
    const scriptOnly =
      cleanedScripts.length > 0 &&
      Object.keys(variableValues).length === 0 &&
      Object.keys(cleanedValveOpenings).length === 0;

    if (!scriptOnly) {
      for (const valve of valves) {
        const key = valve.entityId || valve.name;
        if (key && !(key in cleanedValveOpenings)) {
          cleanedValveOpenings[key] = 0;
        }
      }
    }

    return {
      name: trimmedName,
      variables: variableValues,
      color: color || undefined,
      isBoost,
      luftatorConfig: Object.keys(cleanedValveOpenings).length ? cleanedValveOpenings : undefined,
      scriptEntityIds: cleanedScripts,
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
    scriptRows,
    setScriptRows,
    addScript,
    removeScript,
    setScript,
    submitted,
    setSubmitted,
    getPayload,
  };
}
