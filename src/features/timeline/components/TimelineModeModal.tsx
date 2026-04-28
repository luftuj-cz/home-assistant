import { Button, ColorInput, Group, Modal, Stack, Switch, Text, TextInput } from "@mantine/core";
import { IconEdit, IconFileText, IconPalette, IconPlus, IconTestPipe } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import type { TFunction } from "i18next";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { Valve } from "@luftuj/shared/types/valve";
import type { HruVariable } from "@luftuj/shared/api/hru";
import { cancelBoost, testTimelineMode } from "@luftuj/features/timeline/api";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { useModeForm } from "@luftuj/features/timeline/hooks/useModeForm";
import { ModeVariableFields } from "@luftuj/features/timeline/components/ModeVariableFields";
import { ModeValveSelector } from "@luftuj/features/timeline/components/ModeValveSelector";

interface TimelineModeModalProps {
  opened: boolean;
  mode: Mode | null;
  valves: Valve[];
  saving: boolean;
  onClose: () => void;
  onSave: (mode: Partial<Mode>) => void;
  t: TFunction;
  hruVariables?: HruVariable[];
  maxPower?: number;
  existingModes?: Mode[];
  unitId?: string;
  nameError?: string | null;
  onNameChange?: () => void;
}

export function TimelineModeModal({
  opened,
  mode,
  valves,
  saving,
  onClose,
  onSave,
  t,
  hruVariables = [],
  maxPower,
  existingModes = [],
  nameError,
  onNameChange,
}: TimelineModeModalProps) {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const form = useModeForm(opened, mode, valves);
  const [testRemainingSeconds, setTestRemainingSeconds] = useState<number | null>(null);
  const testTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: debugMode } = useQuery({
    queryKey: ["debug-mode-check"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/debug-mode"));
      if (!res.ok) return { enabled: false };
      return (await res.json()) as { enabled: boolean };
    },
    refetchOnWindowFocus: false,
  });

  const showCopyButton = mode !== null || !!debugMode?.enabled;

  useEffect(() => {
    if (!opened) {
      setTestRemainingSeconds(null);
      if (testTimerRef.current) {
        clearInterval(testTimerRef.current);
        testTimerRef.current = null;
      }
    }
  }, [opened]);

  useEffect(() => {
    if (testRemainingSeconds !== null && testRemainingSeconds > 0) {
      testTimerRef.current = setInterval(() => {
        setTestRemainingSeconds((prev) => {
          if (prev === null || prev <= 1) {
            if (testTimerRef.current) clearInterval(testTimerRef.current);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (testTimerRef.current) clearInterval(testTimerRef.current);
    };
  }, [testRemainingSeconds]);

  function validateForm(): boolean {
    if (!form.name.trim()) {
      notifications.show({
        title: t("settings.timeline.notifications.validationFailedTitle"),
        message: t("validation.requiredField"),
        color: "red",
      });
      return false;
    }
    return true;
  }

  function handleTest() {
    if (testRemainingSeconds !== null) {
      void cancelBoost().then(() => {
        setTestRemainingSeconds(null);
        if (testTimerRef.current) {
          clearInterval(testTimerRef.current);
          testTimerRef.current = null;
        }
        notifications.show({
          title: t("settings.timeline.notifications.testStoppedTitle"),
          message: t("settings.timeline.notifications.testStoppedMessage"),
        });
      });
      return;
    }

    form.setSubmitted(true);
    if (!validateForm()) return;

    testTimelineMode(form.getPayload() as Omit<Mode, "id">, 1)
      .then(() => {
        setTestRemainingSeconds(60);
        notifications.show({
          title: t("settings.timeline.notifications.testStartedTitle"),
          message: t("settings.timeline.notifications.testStartedMessage"),
          color: "blue",
        });
      })
      .catch((err) => {
        notifications.show({
          title: t("valves.alertTitle"),
          message: translateApiError(err, t),
          color: "red",
        });
      });
  }

  function handleSave() {
    form.setSubmitted(true);
    if (!validateForm()) return;
    const payload = form.getPayload();
    const isDuplicate = existingModes.some(
      (m) =>
        m.name.toLowerCase() === (payload.name ?? "").toLowerCase() && (!mode || m.id !== mode.id),
    );
    if (isDuplicate) {
      notifications.show({
        title: t("settings.timeline.notifications.validationFailedTitle"),
        message: t("validation.duplicateModeName"),
        color: "red",
      });
      return;
    }
    onSave({ ...payload, id: mode?.id });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          {mode ? (
            <IconEdit size={20} color="var(--mantine-primary-color-5)" />
          ) : (
            <IconPlus size={20} color="var(--mantine-primary-color-5)" />
          )}
          <Text fw={600}>
            {t(mode ? "settings.timeline.modeEditTitle" : "settings.timeline.modeDialogTitle")}
          </Text>
        </Group>
      }
      size="lg"
      radius="md"
      fullScreen={isMobile}
    >
      <Stack gap="md">
        <TextInput
          label={t("settings.timeline.modeName")}
          placeholder={t("settings.timeline.modePlaceholder")}
          value={form.name}
          onChange={(e) => {
            form.setName(e.target.value);
            onNameChange?.();
          }}
          leftSection={<IconFileText size={16} stroke={1.5} />}
          error={
            nameError || (!form.name.trim() && form.submitted ? t("validation.required") : null)
          }
          required
        />

        <ModeVariableFields
          hruVariables={hruVariables}
          values={form.variableValues}
          onChange={form.setVariableValues}
          maxPower={maxPower}
          submitted={form.submitted}
          t={t}
        />

        <ModeValveSelector
          valves={valves}
          openings={form.valveOpenings}
          onChange={form.setValveOpenings}
          showCopyButton={showCopyButton}
          t={t}
        />

        <ColorInput
          label={t("settings.timeline.modeColor")}
          placeholder={t("settings.timeline.modeColorPlaceholder")}
          value={form.color}
          onChange={form.setColor}
          leftSection={<IconPalette size={16} stroke={1.5} />}
        />

        <Switch
          label={t("settings.timeline.modeIsBoost")}
          description={t("settings.timeline.modeIsBoostDescription")}
          checked={form.isBoost}
          onChange={(e) => form.setIsBoost(e.currentTarget.checked)}
          size="md"
        />

        <Group justify="flex-end" gap="sm" mt="xs" grow={isMobile}>
          <Button variant="light" onClick={onClose} radius="md" fullWidth={isMobile}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            variant="outline"
            leftSection={<IconTestPipe size={16} />}
            onClick={handleTest}
            color={testRemainingSeconds !== null ? "red" : "blue"}
            fullWidth={isMobile}
          >
            {testRemainingSeconds !== null
              ? `${t("settings.timeline.modal.cancel")} (${testRemainingSeconds}s)`
              : t("settings.timeline.modal.test")}
          </Button>
          <Button onClick={handleSave} loading={saving} radius="md" fullWidth={isMobile}>
            {t(mode ? "settings.timeline.modeUpdateAction" : "settings.timeline.modeCreateAction")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
