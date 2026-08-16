import {
  Alert,
  Button,
  ColorInput,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconEdit,
  IconFileText,
  IconPalette,
  IconPlus,
  IconTestPipe,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import type { TFunction } from "i18next";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";
import type { HruVariable } from "@luftuj/shared/api/hru";
import { cancelBoost, testTimelineMode } from "@luftuj/features/timeline/api";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { useModeForm } from "@luftuj/features/timeline/hooks/useModeForm";
import { ModeVariableFields } from "@luftuj/features/timeline/components/ModeVariableFields";
import { ModeValveSelector } from "@luftuj/features/timeline/components/ModeValveSelector";
import { ModeScriptFields } from "@luftuj/features/timeline/components/ModeScriptFields";

interface TimelineModeModalProps {
  opened: boolean;
  mode: Mode | null;
  valves: Valve[];
  valveGroups?: ValveGroup[];
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
  /** Localised name of the season these values belong to, when seasons are on. */
  seasonLabel?: string;
  /**
   * Seasons where this mode already has values, offered as a source to copy
   * from. Only populated while the mode is unconfigured for the viewed season -
   * filling a fresh season by hand is the tedious part of the feature.
   */
  copyFromSeasons?: Array<{ id: number; label: string }>;
  onCopyFromSeason?: (seasonId: number) => Promise<Mode | undefined>;
  /** Puts the mode back to unconfigured for the season being viewed. */
  onClearSeasonValues?: () => void;
}

export function TimelineModeModal({
  opened,
  mode,
  valves,
  valveGroups = [],
  saving,
  onClose,
  onSave,
  t,
  hruVariables = [],
  maxPower,
  existingModes = [],
  nameError,
  onNameChange,
  seasonLabel,
  copyFromSeasons = [],
  onCopyFromSeason,
  onClearSeasonValues,
}: Readonly<TimelineModeModalProps>) {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const form = useModeForm(opened, mode, valves);
  const [testRemainingSeconds, setTestRemainingSeconds] = useState<number | null>(null);
  const [isActivatingTest, setIsActivatingTest] = useState(false);
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

  const showCopyButton = !!debugMode?.enabled;

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

  /**
   * A mode may legitimately consist of activation scripts alone - the summer
   * "open the window instead of running the unit" case seasons were built for.
   * The HRU fields are only mandatory when the mode actually drives the unit,
   * so the check is skipped once scripts are the only thing entered. The
   * backend applies the same rule: values **or** scripts.
   */
  const isScriptOnly =
    form.scriptRows.some((row) => row.value && row.value.trim() !== "") &&
    Object.keys(form.variableValues).length === 0 &&
    Object.values(form.valveOpenings).every((opening) => opening === undefined);

  function validateForm(): boolean {
    if (!form.name.trim()) {
      notifications.show({
        title: t("settings.timeline.notifications.validationFailedTitle"),
        message: t("validation.requiredField"),
        color: "red",
      });
      return false;
    }
    const missingVariable =
      !isScriptOnly &&
      hruVariables
        .filter((v) => v.editable && v.type !== "boolean")
        .some((v) => form.variableValues[v.name] === undefined);
    if (missingVariable) {
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
      setIsActivatingTest(true);
      void cancelBoost()
        .then(() => {
          setTestRemainingSeconds(null);
          if (testTimerRef.current) {
            clearInterval(testTimerRef.current);
            testTimerRef.current = null;
          }
          notifications.show({
            title: t("settings.timeline.notifications.testStoppedTitle"),
            message: t("settings.timeline.notifications.testStoppedMessage"),
          });
        })
        .catch((err) => {
          notifications.show({
            title: t("valves.alertTitle"),
            message: translateApiError(err, t),
            color: "red",
          });
        })
        .finally(() => setIsActivatingTest(false));
      return;
    }

    form.setSubmitted(true);
    if (!validateForm()) return;

    setIsActivatingTest(true);
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
      })
      .finally(() => setIsActivatingTest(false));
  }

  function handleSave() {
    form.setSubmitted(true);
    if (!validateForm()) return;
    const payload = form.getPayload();
    const isDuplicate = existingModes.some(
      (m) => m.name.toLowerCase() === (payload.name ?? "").toLowerCase() && mode?.id !== m.id,
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
            {(() => {
              const base = t(
                mode ? "settings.timeline.modeEditTitle" : "settings.timeline.modeDialogTitle",
              );
              // The dialog is unchanged otherwise: the only difference is which
              // season the values land in, so it has to say which one.
              return seasonLabel
                ? t("settings.timeline.modeSeasonTitle", { title: base, season: seasonLabel })
                : base;
            })()}
          </Text>
        </Group>
      }
      size="lg"
      radius="md"
      fullScreen={isMobile}
    >
      <Stack gap="md">
        {copyFromSeasons.length > 0 && onCopyFromSeason && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Stack gap="xs">
              <Text size="sm">{t("settings.timeline.modeCopyFromSeasonHint")}</Text>
              <Select
                size="xs"
                placeholder={t("settings.timeline.modeCopyFromSeason")}
                data={copyFromSeasons.map((season) => ({
                  value: String(season.id),
                  label: season.label,
                }))}
                onChange={(value) => {
                  if (!value) return;
                  void onCopyFromSeason(Number(value)).then((source) => {
                    if (!source) return;
                    form.setVariableValues(source.variables ?? {});
                    form.setValveOpenings(source.luftatorConfig ?? {});
                    form.setScriptRows(
                      (source.scriptEntityIds ?? []).map((value, index) => ({
                        id: -1 - index,
                        value,
                      })),
                    );
                  });
                }}
                comboboxProps={{ withinPortal: true }}
              />
            </Stack>
          </Alert>
        )}
        <TextInput
          label={t("settings.timeline.modeName")}
          placeholder={t("settings.timeline.modePlaceholder")}
          value={form.name}
          onChange={(e) => {
            form.setName(e.target.value);
            onNameChange?.();
          }}
          description={seasonLabel ? t("settings.timeline.modeSharedFieldsHint") : undefined}
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
          valveGroups={valveGroups}
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

        <ModeScriptFields
          scriptRows={form.scriptRows}
          onAdd={form.addScript}
          onRemove={form.removeScript}
          onChange={form.setScript}
          t={t}
        />

        {isScriptOnly && (
          <Text size="xs" c="dimmed">
            {t("settings.timeline.modeScriptOnlyHint")}
          </Text>
        )}

        <Group justify="flex-end" gap="sm" mt="xs" grow={isMobile}>
          {/* Removing the values for one season is the only way back to the
              unconfigured state, and it is what makes the "set up here but not
              there" model reversible. Offered only where it means something: an
              existing mode that is configured for the season being viewed. */}
          {onClearSeasonValues && mode && mode.configured !== false && (
            <Button
              variant="subtle"
              color="red"
              onClick={onClearSeasonValues}
              disabled={saving || isActivatingTest}
              radius="md"
              fullWidth={isMobile}
            >
              {t("settings.timeline.modeClearSeasonValues")}
            </Button>
          )}
          <Button variant="light" onClick={onClose} radius="md" fullWidth={isMobile}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          <Button
            variant="outline"
            leftSection={testRemainingSeconds === null ? <IconTestPipe size={16} /> : undefined}
            onClick={handleTest}
            color={testRemainingSeconds === null ? "blue" : "red"}
            loading={isActivatingTest}
            loaderProps={{ type: "bars", size: "sm" }}
            disabled={saving}
            fullWidth={isMobile}
          >
            {testRemainingSeconds === null
              ? t("settings.timeline.modal.test")
              : `${t("settings.timeline.modal.cancel")} (${testRemainingSeconds}s)`}
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            disabled={isActivatingTest}
            radius="md"
            fullWidth={isMobile}
          >
            {t(mode ? "settings.timeline.modeUpdateAction" : "settings.timeline.modeCreateAction")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
