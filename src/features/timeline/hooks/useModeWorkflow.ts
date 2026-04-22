import { useState, useCallback } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "../../../types/timeline";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("useModeWorkflow");

export function useModeWorkflow(
  t: TFunction,
  saveMode: (mode: Partial<Mode>) => Promise<boolean>,
  deleteMode: (id: number) => Promise<boolean>,
  loadEvents: (unitId?: string) => Promise<void>,
  activeUnitId?: string,
) {
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<Mode | null>(null);
  const [modeNameError, setModeNameError] = useState<string | null>(null);

  const handleAddMode = useCallback(() => {
    setEditingMode(null);
    setModeNameError(null);
    setModeModalOpen(true);
  }, []);

  const handleEditMode = useCallback((mode: Mode) => {
    setEditingMode(mode);
    setModeNameError(null);
    setModeModalOpen(true);
  }, []);

  const handleSaveMode = useCallback(
    async (modeData: Partial<Mode>) => {
      setModeNameError(null);
      try {
        const success = await saveMode(modeData);
        if (success) {
          setModeModalOpen(false);
          setEditingMode(null);
          logger.info("Mode saved successfully");
        }
      } catch (err) {
        if (err instanceof Error && err.message === "DUPLICATE_NAME") {
          setModeNameError(t("validation.duplicateModeName"));
        }
      }
    },
    [saveMode, t],
  );

  const handleDeleteMode = useCallback(
    async (id: number) => {
      const success = await deleteMode(id);
      if (success) {
        await loadEvents(activeUnitId);
        logger.info("Mode deleted successfully", { id });
      }
    },
    [deleteMode, loadEvents, activeUnitId],
  );

  const handleNameChange = useCallback(() => {
    setModeNameError(null);
  }, []);

  const handleCloseModeModal = useCallback(() => {
    setModeModalOpen(false);
    setEditingMode(null);
  }, []);

  return {
    modeModalOpen,
    editingMode,
    modeNameError,
    handleAddMode,
    handleEditMode,
    handleSaveMode,
    handleDeleteMode,
    handleNameChange,
    handleCloseModeModal,
  };
}
