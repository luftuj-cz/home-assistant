import {
  IconAdjustments,
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconPlus,
  IconScript,
  IconTrash,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ScriptRow } from "@luftuj/features/timeline/hooks/useModeForm";
import { useHaScriptsQuery } from "@luftuj/features/timeline/hooks/useHaScriptsQuery";
import { localizedText as localized } from "@luftuj/features/timeline/utils";
import type { HruVariable } from "@luftuj/shared/api/hru";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import type { Valve, ValveGroup } from "@luftuj/shared/types/valve";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { Field } from "@luftuj/shared/ui/field";
import { Fieldset } from "@luftuj/shared/ui/fieldset";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { IconDamper } from "@luftuj/shared/ui/icons";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Slider } from "@luftuj/shared/ui/slider";
import { Switch } from "@luftuj/shared/ui/switch";
import { getValveGroupBounds } from "@luftuj/shared/utils/valve";

import { ValveRow } from "./ValveRow";

type VariableValue = number | string | boolean;
type Openings = Record<string, number | undefined>;

/** "Výkon je povinný" where the variable has its own message, else "Povinné". */
function requiredMessage(variable: HruVariable, t: TFunction) {
  if (variable.class === "power") return t("validation.powerRequired");
  if (variable.class === "temperature") return t("validation.temperatureRequired");
  if (variable.class === "mode") return t("validation.nativeModeRequired");
  return t("validation.required");
}

/* ---------- Nastavení rekuperace ---------- */

interface VariableFieldsProps {
  variables: HruVariable[];
  values: Record<string, VariableValue>;
  onChange: (
    updater: (prev: Record<string, VariableValue>) => Record<string, VariableValue>,
  ) => void;
  minPower?: number;
  maxPower?: number;
  submitted: boolean;
  scriptOnly: boolean;
}

/** The unit's editable variables in two columns: number → NumberInput, select → Combobox, boolean → a Switch row. */
export function VariableFields({
  variables,
  values,
  onChange,
  minPower,
  maxPower,
  submitted,
  scriptOnly,
}: Readonly<VariableFieldsProps>) {
  const { t } = useTranslation();
  const temperature = useTemperature();
  const editable = variables.filter((variable) => variable.editable);
  if (editable.length === 0) return null;

  function set(name: string, value: VariableValue) {
    onChange((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <Fieldset
      icon={IconAdjustmentsHorizontal}
      legend={t("settings.timeline.hruSettings")}
      description={scriptOnly ? t("settings.timeline.modeEditor.scriptOnlyEmpty") : undefined}
      className="@container"
    >
      <div className="grid grid-cols-2 gap-4 @max-[480px]:grid-cols-[minmax(0,1fr)]">
        {editable.map((variable) => {
          const label = localized(variable.label, t);
          const value = values[variable.name];
          const missing = value === undefined && submitted && !scriptOnly;
          if (variable.type === "boolean") {
            return (
              <Switch
                key={variable.name}
                label={label}
                checked={value === 1 || value === true}
                onCheckedChange={(checked) => set(variable.name, checked ? 1 : 0)}
                className="col-span-full"
              />
            );
          }
          if (variable.type === "select" && variable.options) {
            return (
              <Field
                key={variable.name}
                label={label}
                required
                error={missing ? requiredMessage(variable, t) : undefined}
              >
                <Combobox
                  icon={variable.class === "mode" ? IconAdjustments : undefined}
                  options={variable.options.map((option) => ({
                    value: String(option.value),
                    label: localized(option.label, t),
                  }))}
                  value={value === undefined ? null : String(value)}
                  onValueChange={(next) => set(variable.name, next ? Number.parseInt(next, 10) : 0)}
                  invalid={missing}
                />
              </Field>
            );
          }
          const configurablePower = variable.class === "power";
          const min =
            configurablePower && variable.minConfigurable && minPower != null
              ? minPower
              : variable.min;
          const max =
            configurablePower && variable.maxConfigurable && maxPower != null
              ? maxPower
              : variable.max;
          // Temperatures are stored in °C and shown in the unit picked in Vzhled.
          const isTemperature = variable.class === "temperature";
          function shown(n: number | undefined) {
            if (n == null || !isTemperature) return n;
            return Number(temperature.show(n).toFixed(1));
          }
          function stored(n: number) {
            if (!isTemperature) return n;
            const step = variable.step ?? 0.5;
            // Rounded to the step's decimals too: 151 * 0.1 is 15.100000000000001, not 15.1.
            const decimals = (String(step).split(".")[1] ?? "").length;
            return Number((Math.round(temperature.parse(n) / step) * step).toFixed(decimals));
          }
          let unitLabel = variable.unit ? localized(variable.unit, t) : undefined;
          if (isTemperature) unitLabel = temperature.label;
          return (
            <Field
              key={variable.name}
              label={label}
              required
              error={missing ? requiredMessage(variable, t) : undefined}
            >
              <NumberInput
                value={typeof value === "number" ? (shown(value) ?? null) : null}
                min={shown(min)}
                max={shown(max)}
                step={isTemperature && temperature.unit === "fahrenheit" ? 1 : variable.step}
                unit={unitLabel}
                invalid={missing}
                onValueChange={(next) => set(variable.name, stored(next))}
              />
            </Field>
          );
        })}
      </div>
    </Fieldset>
  );
}

/* ---------- Otevření ventilů ---------- */

interface ValveSectionProps {
  title: string;
  valves: Valve[];
  openings: Openings;
  onChange: (updater: (prev: Openings) => Openings) => void;
  /** Closed it shows "Nastavit vše" instead of the rows. Ungrouped valves are never closed. */
  collapsible: boolean;
  copy: boolean;
}

function ValveSection({
  title,
  valves,
  openings,
  onChange,
  collapsible,
  copy,
}: Readonly<ValveSectionProps>) {
  const { t } = useTranslation();
  const live = valves.filter((valve) => valve.isAvailable);
  // Unavailable valves keep their stored value but cannot be set, so they do not make a group "Různé".
  const values = (live.length > 0 ? live : valves).map((valve) => openings[valve.entityId] ?? 0);
  const mixed = values.some((value) => value !== values[0]);
  // A group set to one value opens closed: its single slider says it all.
  const [open, setOpen] = useState(() => !collapsible || mixed);
  const bounds = getValveGroupBounds(valves);

  function setAll(value: number) {
    onChange((prev) => ({
      ...prev,
      ...Object.fromEntries(live.map((valve) => [valve.entityId, value])),
    }));
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <button
        type="button"
        aria-expanded={collapsible ? open : undefined}
        disabled={!collapsible}
        onClick={() => setOpen(!open)}
        className="group/head flex w-full cursor-pointer items-center gap-2.5 border-0 border-b border-border bg-transparent px-1 py-2 text-left font-sans text-foreground disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {collapsible && (
          <IconChevronDown
            size={14}
            stroke={ICON_STROKE}
            aria-hidden
            className="text-muted-foreground transition-[rotate] duration-(--duration-base) group-aria-[expanded=false]/head:-rotate-90"
          />
        )}
        <span className="label flex-1">{title}</span>
        <span className="caption text-muted-foreground">
          {t("valves.groups.valveCount", { count: valves.length })}
        </span>
        {!open && (
          <span className="code text-muted-foreground">
            {mixed ? t("valves.groups.mixedValues") : `${values[0]}°`}
          </span>
        )}
      </button>
      {open ? (
        <div className="@container grid grid-cols-[minmax(0,1fr)] gap-1.5">
          {valves.map((valve) => (
            <ValveRow
              key={valve.entityId}
              valve={valve}
              value={openings[valve.entityId] ?? 0}
              copy={copy}
              onValueChange={(value) => onChange((prev) => ({ ...prev, [valve.entityId]: value }))}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-md bg-card px-3 py-1.5">
          <span className="caption text-muted-foreground">{t("valves.groups.bulkSetValue")}</span>
          <Slider
            value={mixed ? (bounds.min + bounds.max) / 2 : values[0]}
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            fill="none"
            ticks={6}
            format={(v) => `${v}°`}
            aria-label={t("valves.groups.bulkAria", { name: title })}
            onValueChange={setAll}
          />
        </div>
      )}
    </section>
  );
}

interface ValveFieldsProps {
  valves: Valve[];
  groups: ValveGroup[];
  openings: Openings;
  onChange: (updater: (prev: Openings) => Openings) => void;
  copy: boolean;
}

/**
 * One collapsible block per valve group, then the valves without one. Valves stored on the mode but missing from
 * Home Assistant stay listed as unavailable, so saving keeps their values. The red warning tops it when every
 * live valve would be closed.
 */
export function ValveFields({
  valves,
  groups,
  openings,
  onChange,
  copy,
}: Readonly<ValveFieldsProps>) {
  const { t } = useTranslation();
  const live = new Set(valves.map((valve) => valve.entityId));
  const missing: Valve[] = Object.entries(openings)
    .filter(([entityId]) => !live.has(entityId))
    .map(([entityId, value]) => ({
      entityId,
      name: entityId,
      value: value ?? 0,
      min: 0,
      max: 100,
      step: 5,
      state: "unavailable",
      isAvailable: false,
      attributes: {},
    }));
  if (valves.length + missing.length === 0) return null;

  // Only valves Home Assistant can reach count: an unavailable one stays where it is.
  const reachable = valves.filter((valve) => valve.isAvailable);
  const allClosed =
    reachable.length > 0 &&
    reachable.every((valve) => (openings[valve.entityId] ?? 0) >= valve.max);
  const sorted = groups.toSorted((a, b) => a.sortOrder - b.sortOrder);
  const grouped = new Set(sorted.flatMap((group) => group.entityIds));
  const ungrouped = [...valves.filter((valve) => !grouped.has(valve.entityId)), ...missing];

  return (
    <Fieldset
      icon={IconDamper}
      legend={t("settings.timeline.modeValves")}
      description={t("settings.timeline.modeEditor.valvesDescription")}
    >
      {allClosed && (
        <Alert variant="destructive" title={t("valves.warningTitle")}>
          {t("valves.warnings.allClosed")}
        </Alert>
      )}
      {sorted.map((group) => {
        const members = valves.filter((valve) => group.entityIds.includes(valve.entityId));
        if (members.length === 0) return null;
        return (
          <ValveSection
            key={group.id}
            title={group.name}
            valves={members}
            openings={openings}
            onChange={onChange}
            collapsible
            copy={copy}
          />
        );
      })}
      {ungrouped.length > 0 && (
        <ValveSection
          title={t("valves.groups.ungrouped")}
          valves={ungrouped}
          openings={openings}
          onChange={onChange}
          collapsible={sorted.length > 0}
          copy={copy}
        />
      )}
    </Fieldset>
  );
}

/* ---------- Spustit skripty při aktivaci ---------- */

interface ScriptFieldsProps {
  rows: ScriptRow[];
  onAdd: () => void;
  onRemove: (id: number) => void;
  onChange: (id: number, value: string | null) => void;
  scriptOnly: boolean;
}

/** One searchable picker per script with a remove button; scripts already chosen are not offered again. */
export function ScriptFields({
  rows,
  onAdd,
  onRemove,
  onChange,
  scriptOnly,
}: Readonly<ScriptFieldsProps>) {
  const { t } = useTranslation();
  const { data: scripts = [], isLoading } = useHaScriptsQuery();
  const options = scripts.map((script) => ({
    value: script.entityId,
    label: script.friendlyName,
    code: script.entityId,
  }));
  const chosen = new Set(rows.map((row) => row.value).filter((value) => value !== null));

  return (
    <Fieldset
      icon={IconScript}
      legend={t("settings.timeline.modeScripts")}
      description={t("settings.timeline.modeScriptsDescription")}
      action={
        <Button variant="secondary" size="sm" icon={IconPlus} onClick={onAdd}>
          {t("settings.timeline.modeScriptAdd")}
        </Button>
      }
    >
      {rows.length === 0 && (
        <p className="caption text-muted-foreground">
          {t("settings.timeline.modeEditor.noScripts")}
        </p>
      )}
      {rows.map((row) => {
        let rowOptions = options.filter(
          (option) => option.value === row.value || !chosen.has(option.value),
        );
        // Keep a saved script even when Home Assistant did not list it (e.g. offline).
        if (row.value && !rowOptions.some((option) => option.value === row.value)) {
          rowOptions = [...rowOptions, { value: row.value, label: row.value, code: row.value }];
        }
        return (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <Combobox
              icon={IconScript}
              searchable
              options={rowOptions}
              value={row.value}
              onValueChange={(value) => onChange(row.id, value)}
              placeholder={t("settings.timeline.modeScriptPlaceholder")}
              emptyText={t("settings.timeline.modeScriptNothingFound")}
              disabled={isLoading}
              aria-label={t("settings.timeline.modeScriptPlaceholder")}
            />
            <Button
              variant="danger-ghost"
              size="icon-sm"
              icon={IconTrash}
              aria-label={t("settings.timeline.modeScriptRemove")}
              title={t("settings.timeline.modeScriptRemove")}
              onClick={() => onRemove(row.id)}
            />
          </div>
        );
      })}
      {scriptOnly && (
        <p className="caption text-plan">{t("settings.timeline.modeScriptOnlyHint")}</p>
      )}
    </Fieldset>
  );
}
