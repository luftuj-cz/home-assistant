import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { EngineParams, ParametersPayload } from "@luftuj/features/automatic/api";
import { useParameters, useSaveParameters } from "@luftuj/features/automatic/hooks";
import { Alert } from "@luftuj/shared/ui/alert";
import { Button } from "@luftuj/shared/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@luftuj/shared/ui/card";
import { Field } from "@luftuj/shared/ui/field";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Skeleton } from "@luftuj/shared/ui/skeleton";
import { Switch } from "@luftuj/shared/ui/switch";
import { TimeField } from "@luftuj/shared/ui/time-field";

type NumberKey = Exclude<keyof EngineParams, "fluctuationEnabled" | "dayStart" | "dayEnd">;

interface NumberField {
  key: NumberKey;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
}

const POWER = { unit: "/10", step: 0.1, min: 0, max: 10 };

/** The engine's parameters by topic; labels and help come from `automatic.parameters.fields`. */
const GROUPS: { id: string; fields: NumberField[] }[] = [
  {
    id: "thresholds",
    fields: [
      { key: "th1", unit: "ppm", step: 10, min: 0 },
      { key: "th2", unit: "ppm", step: 10, min: 0 },
      { key: "th1Hysteresis", unit: "ppm", step: 5, min: 0 },
      { key: "th2Hysteresis", unit: "ppm", step: 5, min: 0 },
      { key: "fluctuationOffset", unit: "ppm", step: 10, min: 0 },
      { key: "co2FallingMargin", unit: "ppm", step: 1, min: 0 },
    ],
  },
  {
    id: "power",
    fields: [
      { key: "hruMinPower", ...POWER },
      { key: "hruMaxPowerDay", ...POWER },
      { key: "hruMaxPowerNight", ...POWER },
      { key: "hruMovePower", ...POWER },
      { key: "hruPowerStep", ...POWER },
    ],
  },
  {
    id: "times",
    fields: [
      { key: "thresholdTimeLimit", unit: "s", step: 10, min: 0 },
      { key: "belowTimeLimit", unit: "s", step: 10, min: 0 },
      { key: "hruPowerStepDownInterval", unit: "s", step: 30, min: 0 },
      { key: "powerReviewInterval", unit: "s", step: 60, min: 0 },
      { key: "missingReadingHold", unit: "s", step: 60, min: 0 },
      { key: "powerReviewStepLimit", step: 1, min: 0 },
      { key: "co2FilterAlpha", step: 0.05, min: 0, max: 1 },
    ],
  },
  {
    id: "valves",
    fields: [
      { key: "partialCloseValue", unit: "°", step: 5, min: 0, max: 90 },
      { key: "fullyOpenValue", unit: "°", step: 5, min: 0, max: 90 },
    ],
  },
];

function toTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function fromTime(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60;
}

function unitText(payload: ParametersPayload, t: (key: string) => string): string {
  const unit = payload.power?.unit;
  if (!unit) return "";
  if (typeof unit === "string") return unit;
  return unit.translate ? t(`app.nav.units.${unit.text.replace("hru.", "")}`) : unit.text;
}

/**
 * Every parameter of LUFTaTOR Algo CO2 with its default, the power values also in the unit's terms, and the
 * problems the engine finds in the combination. Saved values apply to the running engine at once.
 */
export function ParametersCard() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useParameters();
  const save = useSaveParameters();
  const [values, setValues] = useState<EngineParams | null>(null);
  const [maxAgeMinutes, setMaxAgeMinutes] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setValues(data.values);
    setMaxAgeMinutes(Math.round(data.maxReadingAgeSeconds / 60));
  }, [data]);

  if (isLoading) return <Skeleton className="h-64" />;
  if (isError || !data || !values || maxAgeMinutes === null) {
    return <Alert variant="destructive">{t("automatic.parameters.loadFailed")}</Alert>;
  }

  function set<K extends keyof EngineParams>(key: K, value: EngineParams[K]) {
    setValues((current) => (current ? { ...current, [key]: value } : current));
  }

  function help(key: keyof EngineParams): string {
    const fallback = data!.defaults[key];
    const shown =
      key === "dayStart" || key === "dayEnd" ? toTime(Number(fallback)) : String(fallback);
    const parts = [t("automatic.parameters.default", { value: shown })];
    const equivalent = data!.power?.equivalents[key];
    if (equivalent !== undefined) {
      parts.push(t("automatic.parameters.inUnit", { value: equivalent, unit: unitText(data!, t) }));
    }
    return parts.join(" · ");
  }

  const dirty =
    JSON.stringify(values) !== JSON.stringify(data.values) ||
    maxAgeMinutes !== Math.round(data.maxReadingAgeSeconds / 60);

  return (
    <Card>
      <CardHeader
        legend={t("automatic.parameters.legend")}
        title={t("automatic.parameters.title")}
        description={t("automatic.parameters.description")}
      />
      <CardContent className="@container grid gap-6">
        {data.problems.length > 0 && (
          <Alert variant="warning" title={t("automatic.parameters.problems")}>
            <ul className="m-0 grid gap-1 pl-4">
              {data.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Alert>
        )}
        {GROUPS.map((group) => (
          <fieldset key={group.id} className="m-0 grid gap-3 border-0 p-0">
            <legend className="legend mb-2">{t(`automatic.parameters.groups.${group.id}`)}</legend>
            <div className="grid gap-3 @min-[560px]:grid-cols-2">
              {group.fields.map((field) => (
                <Field
                  key={field.key}
                  label={t(`automatic.parameters.fields.${field.key}`)}
                  description={help(field.key)}
                >
                  <NumberInput
                    value={values[field.key]}
                    unit={field.unit}
                    step={field.step}
                    min={field.min}
                    max={field.max}
                    onValueChange={(value) => set(field.key, value)}
                  />
                </Field>
              ))}
            </div>
          </fieldset>
        ))}
        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="legend mb-2">{t("automatic.parameters.groups.day")}</legend>
          <div className="grid gap-3 @min-[560px]:grid-cols-2">
            <Field label={t("automatic.parameters.fields.dayStart")} description={help("dayStart")}>
              <TimeField
                value={toTime(values.dayStart)}
                onValueChange={(time) => set("dayStart", fromTime(time))}
              />
            </Field>
            <Field label={t("automatic.parameters.fields.dayEnd")} description={help("dayEnd")}>
              <TimeField
                value={toTime(values.dayEnd)}
                onValueChange={(time) => set("dayEnd", fromTime(time))}
              />
            </Field>
          </div>
          <Switch
            checked={values.fluctuationEnabled}
            onCheckedChange={(checked) => set("fluctuationEnabled", checked)}
            label={t("automatic.parameters.fields.fluctuationEnabled")}
            description={t("automatic.parameters.fluctuationHelp")}
          />
          <Field
            label={t("automatic.parameters.fields.maxReadingAge")}
            description={`${t("automatic.parameters.maxReadingAgeHelp")} ${t(
              "automatic.parameters.default",
              { value: String(Math.round(data.defaultMaxReadingAgeSeconds / 60)) },
            )} min`}
          >
            <NumberInput
              value={maxAgeMinutes}
              unit="min"
              step={15}
              min={1}
              onValueChange={setMaxAgeMinutes}
            />
          </Field>
        </fieldset>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => save.mutate({ overrides: {}, maxReadingAgeSeconds: null })}
          disabled={save.isPending}
        >
          {t("automatic.parameters.reset")}
        </Button>
        <Button
          onClick={() =>
            save.mutate({ overrides: values, maxReadingAgeSeconds: maxAgeMinutes * 60 })
          }
          loading={save.isPending}
          disabled={!dirty}
        >
          {t("automatic.actions.save")}
        </Button>
      </CardFooter>
    </Card>
  );
}
