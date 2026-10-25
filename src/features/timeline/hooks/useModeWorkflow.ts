import { useState, useCallback } from "react";
import type { TFunction } from "i18next";
import type { Mode } from "@luftuj/shared/types/timeline";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("useModeWorkflow");

export function useModeWorkflow(
  t: TFunction,
  saveMode: (mode: Partial<Mode>, duplicateOf?: number) => Promise<boolean>,
  deleteMode: (id: number) => Promise<boolean>,
  refetchEvents?: () => Promise<unknown>,
  _activeUnitId?: string,
) {
  const [modeModalOpen, setModeModalOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<Mode | null>(null);
  // The mode being duplicated, already renamed: it fills the dialog for a new
  // mode, and its id tells the backend where the other seasons' values come from.
  const [duplicateTemplate, setDuplicateTemplate] = useState<Mode | null>(null);
  const [modeNameError, setModeNameError] = useState<string | null>(null);

  const handleAddMode = useCallback(() => {
    setEditingMode(null);
    setDuplicateTemplate(null);
    setModeNameError(null);
    setModeModalOpen(true);
  }, []);

  const handleEditMode = useCallback((mode: Mode) => {
    setEditingMode(mode);
    setDuplicateTemplate(null);
    setModeNameError(null);
    setModeModalOpen(true);
  }, []);

  const handleDuplicateMode = useCallback((template: Mode) => {
    setEditingMode(null);
    setDuplicateTemplate(template);
    setModeNameError(null);
    setModeModalOpen(true);
  }, []);

  const handleSaveMode = useCallback(
    async (modeData: Partial<Mode>) => {
      setModeNameError(null);
      try {
        const success = await saveMode(modeData, duplicateTemplate?.id);
        if (success) {
          setModeModalOpen(false);
          setEditingMode(null);
          setDuplicateTemplate(null);
          logger.info("Mode saved successfully");
        }
      } catch (err) {
        if (err instanceof Error && err.message === "DUPLICATE_NAME") {
          setModeNameError(t("validation.duplicateModeName"));
        }
      }
    },
    [saveMode, duplicateTemplate, t],
  );

  const handleDeleteMode = useCallback(
    async (id: number) => {
      const success = await deleteMode(id);
      if (success && refetchEvents) {
        await refetchEvents();
        logger.info("Mode deleted successfully", { id });
      }
    },
    [deleteMode, refetchEvents],
  );

  const handleNameChange = useCallback(() => {
    setModeNameError(null);
  }, []);

  const handleCloseModeModal = useCallback(() => {
    setModeModalOpen(false);
    setEditingMode(null);
    setDuplicateTemplate(null);
  }, []);

  return {
    modeModalOpen,
    editingMode,
    duplicateTemplate,
    modeNameError,
    handleAddMode,
    handleEditMode,
    handleDuplicateMode,
    handleSaveMode,
    handleDeleteMode,
    handleNameChange,
    handleCloseModeModal,
  };
}
