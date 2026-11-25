import { IconAirConditioning } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SaveBar } from "@luftuj/features/settings/components/SaveBar";
import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import {
  hruTestValues,
  testHruConnection,
  type HruTestResult,
} from "@luftuj/features/settings/hruTest";
import { localizedText } from "@luftuj/features/timeline/utils";
import type { HruUnit } from "@luftuj/shared/api/hru";
import { useTemperature } from "@luftuj/shared/temperature/useTemperature";
import { Combobox } from "@luftuj/shared/ui/combobox";
import { ConnectionTest, type ConnectionTestState } from "@luftuj/shared/ui/connection-test";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";
import { notify } from "@luftuj/shared/ui/notify";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { ApiResponseError, parseApiError, translateApiError } from "@luftuj/shared/utils/apiError";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("HruSection");

interface HruSettings {
  unit: string | null;
  host: string;
  port: number;
  unitId: number;
  minPower: number | undefined;
  maxPower: number | undefined;
}

const initial: HruSettings = {
  unit: null,
  host: "localhost",
  port: 502,
  unitId: 1,
  minPower: undefined,
  maxPower: undefined,
};

/** Modbus state for the summary chip: the address in green, amber while reconnecting, red when down. */
function useModbusTone() {
  const { data } = useQuery({
    queryKey: ["status", "settings-summary"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/status"));
      if (!res.ok) return null;
      return (await res.json()) as { modbus?: { connected?: boolean; reconnecting?: boolean } };
    },
    refetchInterval: 15_000,
  });
  if (!data?.modbus) return undefined;
  if (data.modbus.connected) return "success" as const;
  return data.modbus.reconnecting ? ("warning" as const) : ("destructive" as const);
}

/**
 * Rekuperační jednotka: the unit (searchable, grouped by brand), the Modbus address in mono, the unit's own power
 * limits when it takes them, then the connection test (which reads through the form's values, saved or not) and
 * the SaveBar.
 */
export function HruSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const temperature = useTemperature();
  const modbusTone = useModbusTone();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [units, setUnits] = useState<HruUnit[]>([]);
  const [settings, setSettings] = useState<HruSettings>(initial);
  const [saved, setSaved] = useState<HruSettings>(initial);
  const [test, setTest] = useState<ConnectionTestState>("idle");
  const [testError, setTestError] = useState<{ message: string; code?: string } | null>(null);
  const [testResult, setTestResult] = useState<HruTestResult | null>(null);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const [unitsRes, settingsRes] = await Promise.all([
          fetch(resolveApiUrl("/api/hru/units"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/hru"), { cache: "no-cache" }),
        ]);
        if (canceled) return;
        if (unitsRes.ok) setUnits(await unitsRes.json());
        if (settingsRes.ok) {
          const loaded = { ...initial, ...((await settingsRes.json()) as HruSettings) };
          setSaved(loaded);
          setSettings(loaded);
        }
      } catch (err) {
        logger.error("Failed to load HRU settings", { error: err });
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  const selectedUnit = units.find((unit) => unit.id === settings.unit);
  const unitOptions = useMemo(
    () =>
      units.map((unit) => ({
        value: unit.id,
        label: unit.name,
        // The brand is the first word of the name: Atrea, Brink, Elektrodesign…
        group: unit.name.split(" ")[0],
      })),
    [units],
  );

  function resetTest() {
    setTest("idle");
    setTestError(null);
    setTestResult(null);
  }

  function update<K extends keyof HruSettings>(key: K, value: HruSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    resetTest();
  }

  function defaultPowerLimits(unitId: string | null): Pick<HruSettings, "minPower" | "maxPower"> {
    const powerVar = units
      .find((unit) => unit.id === unitId)
      ?.variables?.find((variable) => variable.class === "power");
    return {
      minPower: powerVar?.minConfigurable ? (powerVar.minDefault ?? powerVar.min) : undefined,
      maxPower: powerVar?.maxConfigurable ? (powerVar.maxDefault ?? powerVar.max) : undefined,
    };
  }

  function selectUnit(unitId: string | null) {
    // minPower and maxPower are per unit (m³/h on one, % on another): back on the saved unit its saved limits
    // apply, any other unit starts from its own defaults.
    const limits =
      unitId === saved.unit
        ? { minPower: saved.minPower, maxPower: saved.maxPower }
        : defaultPowerLimits(unitId);
    setSettings((prev) => (prev.unit === unitId ? prev : { ...prev, unit: unitId, ...limits }));
    resetTest();
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/hru"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        notify({
          title: t("settings.hru.notifications.saveFailedTitle"),
          message: translateApiError(err, t),
          variant: "error",
        });
        return false;
      }
      setSaved(settings);
      // Almost every cached query is about the configured unit - modes, seasons, plans - so none of it may
      // outlive a change. The dashboard's host and unit are dropped outright: merely stale, they would still be
      // rendered on the next visit and probe the old address once before the refetch lands.
      queryClient.removeQueries({ queryKey: ["hru-config"] });
      void queryClient.invalidateQueries();
      return true;
    } catch (error) {
      logger.error("Failed to save HRU settings", { error });
      notify({
        title: t("settings.hru.notifications.saveFailedTitle"),
        message: t("settings.hru.notifications.unknown"),
        variant: "error",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (!settings.unit) return;
    resetTest();
    setTest("testing");
    try {
      setTestResult(
        await testHruConnection({
          ...settings,
          unit: settings.unit,
        }),
      );
      setTest("success");
    } catch (error) {
      if (error instanceof ApiResponseError) {
        setTestError({ message: translateApiError(error, t), code: error.code });
      } else {
        logger.error("HRU probe failed", { error });
        setTestError({ message: t("settings.hru.notifications.connectionFailed") });
      }
      setTest("error");
    }
  }

  const unitMissing = !settings.unit;
  const hostMissing = settings.host.trim() === "";
  const portMissing = !Number.isFinite(settings.port) || settings.port <= 0;
  // 0–255 like the backend and onboarding: some gateways answer only on unit id 0.
  const unitIdMissing = !Number.isFinite(settings.unitId) || settings.unitId < 0;

  const powerVar = selectedUnit?.variables?.find(
    (variable) =>
      variable.class === "power" && (variable.maxConfigurable || variable.minConfigurable),
  );
  const powerUnit = powerVar?.unit ? localizedText(powerVar.unit, t) : "%";
  const effectiveMax = powerVar?.maxConfigurable
    ? (settings.maxPower ?? powerVar.maxDefault ?? powerVar.max)
    : powerVar?.max;
  const minMissing = powerVar?.minConfigurable === true && settings.minPower == null;
  const maxMissing = powerVar?.maxConfigurable === true && settings.maxPower == null;
  const minAboveMax =
    powerVar?.minConfigurable === true &&
    settings.minPower != null &&
    effectiveMax !== undefined &&
    settings.minPower > effectiveMax;
  let minError: string | undefined;
  if (minMissing) minError = t("settings.hru.configuration.minPowerRequired");
  else if (minAboveMax) minError = t("settings.hru.configuration.minPowerAboveMax");

  const invalid = unitMissing || hostMissing || portMissing || unitIdMissing || minAboveMax;
  const dirty = !loading && JSON.stringify(settings) !== JSON.stringify(saved);

  // What the test read, as a strip: the unit's dashboard values with their units (temperatures converted).
  const testValues = hruTestValues(testResult, t, temperature);

  const savedUnitName = units.find((unit) => unit.id === saved.unit)?.name;

  return (
    <SettingsSection
      value="hru"
      index="02"
      icon={IconAirConditioning}
      title={t("settings.hru.title")}
      description={t("settings.hru.sectionDescription")}
      dirty={dirty}
      summary={
        savedUnitName ? (
          <>
            <SummaryChip>{savedUnitName}</SummaryChip>
            <SummaryChip tone={modbusTone} mono>
              {`${saved.host}:${saved.port}`}
            </SummaryChip>
          </>
        ) : (
          <SummaryChip tone="warning">{t("settings.hru.notConfigured")}</SummaryChip>
        )
      }
    >
      <Field
        label={t("settings.hru.unitLabel")}
        required
        error={!loading && unitMissing ? t("settings.hru.unitRequired") : undefined}
      >
        <Combobox
          options={unitOptions}
          value={settings.unit}
          onValueChange={selectUnit}
          placeholder={t("settings.hru.unitPlaceholder")}
          searchable
          disabled={loading}
        />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_130px_130px] gap-4 @max-[520px]:grid-cols-2 @max-[520px]:[&>:first-child]:col-span-2">
        <Field
          label={t("settings.hru.hostLabel")}
          required
          error={hostMissing ? t("settings.hru.hostRequired") : undefined}
        >
          <Input
            value={settings.host}
            onChange={(event) => update("host", event.target.value)}
            placeholder="localhost"
            className="font-mono"
            spellCheck={false}
          />
        </Field>
        <Field
          label={t("settings.hru.portLabel")}
          required
          error={portMissing ? t("settings.hru.portRequired") : undefined}
        >
          <NumberInput
            value={settings.port}
            min={1}
            max={65535}
            onValueChange={(value) => update("port", value)}
          />
        </Field>
        <Field
          label={t("settings.hru.unitIdLabel")}
          required
          error={unitIdMissing ? t("settings.hru.unitIdRequired") : undefined}
        >
          <NumberInput
            value={settings.unitId}
            min={0}
            max={255}
            onValueChange={(value) => update("unitId", value)}
          />
        </Field>
      </div>

      {powerVar && (
        <div className="grid gap-3">
          <div className="grid gap-0.5">
            <span className="label">{t("settings.hru.configuration.title")}</span>
            <span className="caption text-muted-foreground">
              {powerVar.minConfigurable
                ? t("settings.hru.configuration.limitsDescription")
                : t("settings.hru.configuration.maxPowerDescription")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 @max-[520px]:grid-cols-[minmax(0,1fr)]">
            {powerVar.minConfigurable && (
              <Field
                label={t("settings.hru.configuration.minPowerLabel")}
                description={t("settings.hru.configuration.minPowerHint", {
                  default: powerVar.minDefault ?? powerVar.min,
                  unit: powerUnit,
                })}
                error={minError}
              >
                <NumberInput
                  value={settings.minPower ?? powerVar.minDefault ?? powerVar.min ?? null}
                  min={powerVar.min ?? 0}
                  max={effectiveMax ?? 10000}
                  unit={powerUnit}
                  invalid={Boolean(minError)}
                  onValueChange={(value) => update("minPower", value)}
                />
              </Field>
            )}
            {powerVar.maxConfigurable && (
              <Field
                label={t("settings.hru.configuration.maxPowerLabel")}
                description={t("settings.hru.configuration.maxPowerHint", {
                  default: powerVar.maxDefault ?? powerVar.max,
                  unit: powerUnit,
                })}
                error={maxMissing ? t("settings.hru.configuration.maxPowerRequired") : undefined}
              >
                <NumberInput
                  value={settings.maxPower ?? powerVar.maxDefault ?? powerVar.max ?? null}
                  min={1}
                  max={10000}
                  unit={powerUnit}
                  onValueChange={(value) => update("maxPower", value)}
                />
              </Field>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <ConnectionTest
          state={test}
          onTest={() => void runTest()}
          disabled={loading || unitMissing || hostMissing}
          hint={t("settings.testFormHint")}
          error={testError?.message}
          code={testError?.code}
          detail={`${settings.host}:${settings.port}`}
          values={testValues}
          valuesLegend={t("settings.hru.probeResultTitle")}
        />
      </div>
      <SaveBar
        dirty={dirty}
        saving={saving}
        disabled={invalid}
        label={t("settings.hru.save")}
        onSave={save}
        onDiscard={() => {
          setSettings(saved);
          resetTest();
        }}
      />
    </SettingsSection>
  );
}
