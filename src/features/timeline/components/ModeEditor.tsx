import { IconAlertTriangle, IconPlayerPlay } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { cancelBoost, testTimelineMode } from "@luftuj/features/timeline/api";
import { useModeForm } from "@luftuj/features/timeline/hooks/useModeForm";
import { localizedText } from "@luftuj/features/timeline/utils";
import type { HruVariable } from "@luftuj/shared/api/hru";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import type { Mode } from "@luftuj/shared/types/timeline";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";
import { Alert } from "@luftuj/shared/ui/alert";
import { Badge } from "@luftuj/shared/ui/badge";
import { Button } from "@luftuj/shared/ui/button";
import { ColorField } from "@luftuj/shared/ui/color-field";
import { Combobox } from "@luftuj/shared/ui/combobox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@luftuj/shared/ui/dialog";
import { Field } from "@luftuj/shared/ui/field";
import { Fieldset } from "@luftuj/shared/ui/fieldset";
import { Input } from "@luftuj/shared/ui/input";
import { Legend } from "@luftuj/shared/ui/legend";
import { notify } from "@luftuj/shared/ui/notify";
import { Switch } from "@luftuj/shared/ui/switch";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { translateApiError } from "@luftuj/shared/utils/apiError";
import { cn } from "@luftuj/shared/utils/cn";

import { ScriptFields, ValveFields, VariableFields } from "./ModeEditorFields";

const TEST_SECONDS = 60;

/** The mode palette (`--mode-1…8`), stored as hex so a mode keeps its colour in both themes' data. */
const SWATCH_COLORS = [
  "#0b6f80",
  "#2f7d4f",
  "#6a5bc4",
  "#b4470f",
  "#8b3a7e",
  "#3567a6",
  "#8a6400",
  "#56656a",
];

interface ModeEditorProps {
  open: boolean;
  mode: Mode | null;
  /** Fills the form of a new mode, e.g. from the mode being duplicated. Ignored when editing. */
  template?: Mode | null;
  valves: Valve[];
  valveGroups?: ValveGroup[];
  saving: boolean;
  onClose: () => void;
  onSave: (mode: Partial<Mode>) => void;
  hruVariables?: HruVariable[];
  minPower?: number;
  maxPower?: number;
  existingModes?: Mode[];
  nameError?: string | null;
  onNameChange?: () => void;
  /** Localised name of the season these values belong to, when seasons are on. */
  seasonLabel?: string;
  /** Seasons that hold values for this mode, offered while it has none in the viewed season. */
  copyFromSeasons?: Array<{ id: number; label: string }>;
  onCopyFromSeason?: (seasonId: number) => Promise<Mode | undefined>;
  /** Puts the mode back to unconfigured for the season being viewed. */
  onClearSeasonValues?: () => void;
}

/** Remaining test seconds, counting down while a test runs; `null` when none does. */
function useTestCountdown(open: boolean) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!open) setLeft(null);
  }, [open]);
  const running = left !== null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(
      () => setLeft((prev) => (prev === null || prev <= 1 ? null : prev - 1)),
      1000,
    );
    return () => clearInterval(id);
  }, [running]);
  return [left, setLeft] as const;
}

/**
 * Vytvořit / upravit / duplikovat režim (replaces TimelineModeModal and its field components). A live summary
 * stays on top of the scrolling body; then name and colour, the unit's values, valve openings by group, the
 * manual-action switch and activation scripts. Test runs the form for 60 s; validation marks the fields and
 * scrolls to the first.
 */
export function ModeEditor({
  open,
  mode,
  template = null,
  valves,
  valveGroups = [],
  saving,
  onClose,
  onSave,
  hruVariables = [],
  minPower,
  maxPower,
  existingModes = [],
  nameError,
  onNameChange,
  seasonLabel,
  copyFromSeasons = [],
  onCopyFromSeason,
  onClearSeasonValues,
}: Readonly<ModeEditorProps>) {
  const { t } = useTranslation();
  const temperature = useTemperature();
  const form = useModeForm(open, mode ?? template, valves);
  const duplicating = !mode && template !== null;
  const [testLeft, setTestLeft] = useTestCountdown(open);
  const [testBusy, setTestBusy] = useState(false);
  const [duplicateName, setDuplicateName] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { data: debugMode } = useQuery({
    queryKey: ["debug-mode-check"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/debug-mode"));
      if (!res.ok) return { enabled: false };
      return (await res.json()) as { enabled: boolean };
    },
    refetchOnWindowFocus: false,
  });

  // A new mode starts on the first palette colour instead of none.
  const { color, setColor } = form;
  useEffect(() => {
    if (open && !mode && !template?.color) setColor(SWATCH_COLORS[0]);
    setDuplicateName(false);
  }, [open, mode, template, setColor]);
  const shownColor = color || SWATCH_COLORS[0];

  /**
   * A mode may consist of activation scripts alone - the summer "open the window instead of running the unit"
   * case. The unit's values are then not required; the backend applies the same rule: values or scripts.
   */
  const scriptOnly =
    form.scriptRows.some((row) => row.value && row.value.trim() !== "") &&
    Object.keys(form.variableValues).length === 0 &&
    Object.values(form.valveOpenings).every((opening) => opening === undefined);

  const editable = hruVariables.filter((variable) => variable.editable);

  function revealFirstInvalid() {
    requestAnimationFrame(() =>
      bodyRef.current
        ?.querySelector('[aria-invalid="true"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
  }

  function validate(): boolean {
    const missingName = !form.name.trim();
    const missingVariable =
      !scriptOnly &&
      editable
        .filter((variable) => variable.type !== "boolean")
        .some((variable) => form.variableValues[variable.name] === undefined);
    if (missingName || missingVariable) {
      revealFirstInvalid();
      return false;
    }
    return true;
  }

  function runTest() {
    if (testLeft !== null) {
      setTestBusy(true);
      void cancelBoost()
        .then(() => {
          setTestLeft(null);
          notify({
            title: t("settings.timeline.notifications.testStoppedTitle"),
            message: t("settings.timeline.notifications.testStoppedMessage"),
          });
        })
        .catch((err) =>
          notify({
            title: t("valves.alertTitle"),
            message: translateApiError(err, t),
            variant: "error",
          }),
        )
        .finally(() => setTestBusy(false));
      return;
    }
    form.setSubmitted(true);
    if (!validate()) return;
    setTestBusy(true);
    testTimelineMode(form.getPayload() as Omit<Mode, "id">, 1)
      .then(() => {
        setTestLeft(TEST_SECONDS);
        notify({
          title: t("settings.timeline.notifications.testStartedTitle"),
          message: t("settings.timeline.notifications.testStartedMessage"),
          variant: "info",
        });
      })
      .catch((err) =>
        notify({
          title: t("valves.alertTitle"),
          message: translateApiError(err, t),
          variant: "error",
        }),
      )
      .finally(() => setTestBusy(false));
  }

  function save() {
    form.setSubmitted(true);
    if (!validate()) return;
    const payload = form.getPayload();
    const taken = existingModes.some(
      (other) =>
        other.name.toLowerCase() === (payload.name ?? "").toLowerCase() && mode?.id !== other.id,
    );
    if (taken) {
      setDuplicateName(true);
      revealFirstInvalid();
      return;
    }
    onSave({ ...payload, id: mode?.id });
  }

  let base = t("settings.timeline.modeDialogTitle");
  if (mode) base = t("settings.timeline.modeEditTitle");
  else if (duplicating) base = t("settings.timeline.modeDuplicateTitle");

  let nameMessage: string | undefined;
  if (nameError) nameMessage = nameError;
  else if (duplicateName) nameMessage = t("validation.duplicateModeName");
  else if (form.submitted && !form.name.trim()) nameMessage = t("validation.requiredField");

  // The summary: numeric values with units, the unit's own mode, and one bar per live valve.
  const numberVariables = editable.filter((variable) => variable.type === "number");
  const selectVariable = editable.find((variable) => variable.type === "select");
  const selectValue = selectVariable ? form.variableValues[selectVariable.name] : undefined;
  const selectLabel = selectVariable?.options?.find(
    (option) => option.value === selectValue,
  )?.label;
  const liveValves = valves.filter((valve) => valve.isAvailable);
  const valveStates = liveValves.map((valve) => {
    const value = form.valveOpenings[valve.entityId] ?? 0;
    if (value <= valve.min) return "open";
    return value >= valve.max ? "closed" : "partial";
  });
  function count(state: string) {
    return valveStates.filter((entry) => entry === state).length;
  }

  const swatches = SWATCH_COLORS.map((value, index) => ({
    value,
    label: t(`ui.colors.mode${index + 1}`),
  }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg" scroll>
        <DialogHeader
          legend={
            seasonLabel
              ? t("settings.timeline.modeEditor.legendSeason", { season: seasonLabel })
              : t("settings.timeline.modeEditor.legend")
          }
          title={mode ? mode.name : base}
          description={mode ? base : undefined}
        />
        <DialogBody ref={bodyRef}>
          <div
            aria-label={t("settings.timeline.modeEditor.summary")}
            role="group"
            style={{ "--mc": shownColor } as CSSProperties}
            className="sticky -top-2 z-3 -mx-6 -mt-2 mb-2 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-[color-mix(in_oklab,var(--mc)_30%,var(--border))] bg-[color-mix(in_oklab,var(--popover)_88%,var(--mc))] px-6 py-2.5 backdrop-blur-sm transition-[background-color] duration-(--duration-slow)"
          >
            <span aria-hidden="true" className="h-9 w-2.5 flex-none rounded-[3px] bg-(--mc)" />
            <div className="flex min-w-0 flex-[1_1_140px] items-center gap-2">
              <span className="label truncate">
                {form.name.trim() || t("settings.timeline.modeEditor.newMode")}
              </span>
              {form.isBoost && (
                <Badge variant="manual">{t("settings.timeline.modeIsBoostBadge")}</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {numberVariables.map((variable) => {
                const raw = form.variableValues[variable.name];
                const isTemperature = variable.class === "temperature";
                const value =
                  isTemperature && typeof raw === "number"
                    ? Number(temperature.show(raw).toFixed(1))
                    : raw;
                return (
                  <span key={variable.name} className="grid">
                    <Legend className="text-[10px] leading-3">
                      {localizedText(variable.label, t)}
                    </Legend>
                    <span className="readout-sm text-[15px] leading-5">
                      {typeof value === "number" ? value : "—"}
                      {(isTemperature || variable.unit) && (
                        <small className="text-xs text-muted-foreground">
                          {" "}
                          {isTemperature
                            ? temperature.label
                            : variable.unit && localizedText(variable.unit, t)}
                        </small>
                      )}
                    </span>
                  </span>
                );
              })}
              {selectVariable && (
                <span className="grid">
                  <Legend className="text-[10px] leading-3">
                    {localizedText(selectVariable.label, t)}
                  </Legend>
                  <span className="readout-sm text-[15px] leading-5">
                    {selectLabel ? localizedText(selectLabel, t) : "—"}
                  </span>
                </span>
              )}
              {liveValves.length > 0 && (
                <span className="grid">
                  <Legend className="text-[10px] leading-3">
                    {t("settings.timeline.modeEditor.valves")}
                  </Legend>
                  <span
                    className="flex h-5 items-center gap-[3px]"
                    title={t("settings.timeline.modeEditor.valvesTitle", {
                      open: count("open"),
                      partial: count("partial"),
                      closed: count("closed"),
                    })}
                  >
                    {valveStates.map((state, index) => (
                      <i
                        key={liveValves[index].entityId}
                        className={cn(
                          "h-3.5 w-2 rounded-[2px] transition-[background-color] duration-(--duration-base)",
                          state === "open" && "bg-air",
                          state === "partial" &&
                            "bg-[color-mix(in_oklab,var(--air)_45%,var(--muted))]",
                          state === "closed" && "shadow-[inset_0_0_0_1.5px_var(--valve-closed)]",
                        )}
                      />
                    ))}
                  </span>
                </span>
              )}
            </div>
          </div>

          {testLeft !== null && (
            <Alert variant="info" title={t("settings.timeline.modeEditor.testRunningTitle")}>
              {t("settings.timeline.modeEditor.testRunningBody")}
            </Alert>
          )}

          {copyFromSeasons.length > 0 && onCopyFromSeason && (
            <Fieldset
              tone="warning"
              icon={IconAlertTriangle}
              legend={t("settings.timeline.modeEditor.unconfiguredTitle")}
              description={t("settings.timeline.modeCopyFromSeasonHint")}
            >
              <Combobox
                aria-label={t("settings.timeline.modeCopyFromSeason")}
                placeholder={t("settings.timeline.modeCopyFromSeason")}
                options={copyFromSeasons.map((season) => ({
                  value: String(season.id),
                  label: season.label,
                }))}
                value={null}
                onValueChange={(value) => {
                  if (!value) return;
                  void onCopyFromSeason(Number(value)).then((source) => {
                    if (!source) return;
                    form.setVariableValues(source.variables ?? {});
                    form.setValveOpenings(source.luftatorConfig ?? {});
                    form.setScriptRows(
                      (source.scriptEntityIds ?? []).map((entityId, index) => ({
                        id: -1 - index,
                        value: entityId,
                      })),
                    );
                  });
                }}
              />
            </Fieldset>
          )}

          <Field
            label={t("settings.timeline.modeName")}
            required
            description={seasonLabel ? t("settings.timeline.modeSharedFieldsHint") : undefined}
            error={nameMessage}
          >
            <Input
              value={form.name}
              placeholder={t("settings.timeline.modePlaceholder")}
              onChange={(event) => {
                form.setName(event.target.value);
                setDuplicateName(false);
                onNameChange?.();
              }}
            />
          </Field>
          <Field label={t("settings.timeline.modeEditor.color")}>
            <ColorField swatches={swatches} value={shownColor} onValueChange={setColor} />
          </Field>

          <VariableFields
            variables={hruVariables}
            values={form.variableValues}
            onChange={form.setVariableValues}
            minPower={minPower}
            maxPower={maxPower}
            submitted={form.submitted}
            scriptOnly={scriptOnly}
          />

          <ValveFields
            valves={valves}
            groups={valveGroups}
            openings={form.valveOpenings}
            onChange={form.setValveOpenings}
            copy={Boolean(debugMode?.enabled)}
          />

          {/* It decides whether the mode appears on Přehled, so it gets a well of its own. */}
          <div className="rounded-lg bg-manual-soft p-4 [&_[data-slot=switch-label]]:text-manual">
            <Switch
              label={t("settings.timeline.modeIsBoost")}
              description={t("settings.timeline.modeIsBoostDescription")}
              checked={form.isBoost}
              onCheckedChange={form.setIsBoost}
            />
          </div>

          <ScriptFields
            rows={form.scriptRows}
            onAdd={form.addScript}
            onRemove={form.removeScript}
            onChange={form.setScript}
            scriptOnly={scriptOnly}
          />
        </DialogBody>
        <DialogFooter
          start={
            // The only way back to "not set up here", offered where it means something: an existing mode that
            // has values in the viewed season.
            onClearSeasonValues &&
            mode &&
            mode.configured !== false && (
              <Button
                variant="danger-ghost"
                disabled={saving || testBusy}
                onClick={onClearSeasonValues}
              >
                {t("settings.timeline.modeClearSeasonValues")}
              </Button>
            )
          }
        >
          <Button variant="ghost" onClick={onClose}>
            {t("settings.timeline.modal.cancel")}
          </Button>
          {testLeft === null ? (
            <Button
              variant="outline"
              icon={IconPlayerPlay}
              loading={testBusy}
              disabled={saving}
              onClick={runTest}
            >
              {t("settings.timeline.modal.test")}
            </Button>
          ) : (
            <Button
              variant="outline"
              loading={testBusy}
              onClick={runTest}
              className="text-destructive shadow-[inset_0_0_0_1px_var(--destructive)]"
            >
              <span
                aria-hidden="true"
                className="size-4 flex-none rounded-full transition-[background] duration-1000 ease-linear"
                style={{
                  background: `conic-gradient(currentColor ${(testLeft / TEST_SECONDS) * 360}deg, color-mix(in oklab, currentColor 20%, transparent) 0)`,
                }}
              />
              {t("settings.timeline.modeEditor.cancelTest")} ·{" "}
              <span className="code">
                {t("settings.timeline.modeEditor.seconds", { count: testLeft })}
              </span>
            </Button>
          )}
          <Button loading={saving} disabled={testBusy} onClick={save}>
            {mode
              ? t("settings.timeline.modeUpdateAction")
              : t("settings.timeline.modeCreateAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
