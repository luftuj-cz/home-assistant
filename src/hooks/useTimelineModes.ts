import { useState, useCallback, useRef, useEffect } from "react";
import { notifications } from "@mantine/notifications";
import type { TFunction } from "i18next";
import type { Mode } from "../types/timeline";
import * as api from "../api/timeline";

export function useTimelineModes(t: TFunction) {
  const [modes, setModes] = useState<Mode[]>([]);
  const [savingMode, setSavingMode] = useState(false);
  const tRef = useRef(t);

  function mapModeForUi(mode: Mode): Mode {
    if (mode.variables && Object.keys(mode.variables).length > 0) return mode;

    const variables: Record<string, number> = {};
    if (typeof mode.power === "number") variables.power = mode.power;
    if (typeof mode.temperature === "number") variables.temperature = mode.temperature;
    if (typeof mode.nativeMode === "number") variables.mode = mode.nativeMode;

    return Object.keys(variables).length > 0 ? { ...mode, variables } : mode;
  }

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const loadModes = useCallback(async (unitId?: string) => {
    try {
      const data = await api.fetchTimelineModes(unitId);
      setModes(data.map(mapModeForUi));
    } catch {
      notifications.show({
        title: tRef.current("settings.timeline.notifications.loadFailedTitle"),
        message: tRef.current("settings.timeline.notifications.loadFailedModes"),
        color: "red",
      });
    }
  }, []);

  const saveMode = useCallback(async (mode: Partial<Mode>) => {
    setSavingMode(true);
    try {
      let saved: Mode;
      const isEdit = typeof mode.id === "number";

      if (isEdit) {
        saved = await api.updateTimelineMode(mode as Mode);
      } else {
        saved = await api.createTimelineMode(mode as Omit<Mode, "id">);
      }

      const mappedSaved = mapModeForUi(saved);

      setModes((prev) => {
        if (isEdit) {
          return prev.map((m) => (m.id === mappedSaved.id ? mappedSaved : m));
        }
        return [...prev, mappedSaved];
      });

      notifications.show({
        title: tRef.current("settings.timeline.notifications.saveSuccessTitle"),
        message: tRef.current(
          isEdit
            ? "settings.timeline.notifications.modeUpdated"
            : "settings.timeline.notifications.modeCreated",
        ),
        color: "green",
      });
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Check for duplicate name error (409)
      if (errorMessage.includes("Mode name already exists")) {
        // Rethrow so the modal can handle it
        throw new Error("DUPLICATE_NAME");
      }

      notifications.show({
        title: tRef.current("settings.timeline.notifications.saveFailedTitle"),
        message:
          err instanceof Error
            ? err.message
            : tRef.current("settings.timeline.notifications.saveFailedMessage"),
        color: "red",
      });
      return false;
    } finally {
      setSavingMode(false);
    }
  }, []);

  const deleteMode = useCallback(async (id: number) => {
    try {
      await api.deleteTimelineMode(id);
      setModes((prev) => prev.filter((m) => m.id !== id));
      notifications.show({
        title: tRef.current("settings.timeline.notifications.modeDeleteSuccessTitle"),
        message: tRef.current("settings.timeline.notifications.modeDeleteSuccessMessage"),
        color: "green",
      });
      return true;
    } catch (err) {
      notifications.show({
        title: tRef.current("settings.timeline.notifications.deleteFailedTitle"),
        message:
          err instanceof Error
            ? err.message
            : tRef.current("settings.timeline.notifications.deleteFailedMessage"),
        color: "red",
      });
      return false;
    }
  }, []);

  return { modes, loadModes, saveMode, deleteMode, savingMode };
}
