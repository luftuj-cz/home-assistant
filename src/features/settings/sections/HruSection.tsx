import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconServer } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { HruUnit } from "@luftuj/shared/api/hru";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError, translateApiError } from "@luftuj/shared/utils/apiError";
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

export function HruSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [units, setUnits] = useState<HruUnit[]>([]);
  const [settings, setSettings] = useState<HruSettings>(initial);
  const savedSettings = useRef<HruSettings | null>(null);
  const [probeStatus, setProbeStatus] = useState<"success" | "error" | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    async function load() {
      setLoading(true);
      try {
        const [unitsRes, settingsRes] = await Promise.all([
          fetch(resolveApiUrl("/api/hru/units"), { cache: "no-cache" }),
          fetch(resolveApiUrl("/api/settings/hru"), { cache: "no-cache" }),
        ]);
        if (canceled) return;
        if (unitsRes.ok) setUnits(await unitsRes.json());
        if (settingsRes.ok) {
          const loaded = (await settingsRes.json()) as HruSettings;
          savedSettings.current = loaded;
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

  const unitOptions = useMemo(() => units.map((u) => ({ value: u.id, label: u.name })), [units]);
  const selectedUnit = useMemo(
    () => units.find((u) => u.id === settings.unit),
    [units, settings.unit],
  );

  function clearProbe() {
    setProbeStatus(null);
    setProbeError(null);
  }

  function update<K extends keyof HruSettings>(key: K, value: HruSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    clearProbe();
  }

  function defaultPowerLimits(unitId: string | null): Pick<HruSettings, "minPower" | "maxPower"> {
    const powerVar = units
      .find((u) => u.id === unitId)
      ?.variables?.find((v) => v.class === "power");
    return {
      minPower: powerVar?.minConfigurable ? (powerVar.minDefault ?? powerVar.min) : undefined,
      maxPower: powerVar?.maxConfigurable ? (powerVar.maxDefault ?? powerVar.max) : undefined,
    };
  }

  function selectUnit(unitId: string | null) {
    // minPower and maxPower are per unit (m³/h on one, % on another): back on the
    // saved unit its saved limits apply, any other unit starts from its own defaults.
    const saved = savedSettings.current;
    const limits =
      unitId === saved?.unit
        ? { minPower: saved.minPower, maxPower: saved.maxPower }
        : defaultPowerLimits(unitId);
    setSettings((prev) => (prev.unit === unitId ? prev : { ...prev, unit: unitId, ...limits }));
    clearProbe();
  }

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/hru"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        notifications.show({
          title: t("settings.hru.notifications.saveFailedTitle"),
          message: translateApiError(err, t),
          color: "red",
        });
        return;
      }
      savedSettings.current = settings;
      // Almost every cached query is about the configured unit - modes, seasons,
      // plans - so none of it may outlive a change. The dashboard's host and unit
      // are dropped outright: merely stale, they would still be rendered on the
      // next visit and probe the old address once before the refetch lands.
      queryClient.removeQueries({ queryKey: ["hru-config"] });
      void queryClient.invalidateQueries();
      notifications.show({
        title: t("settings.hru.notifications.saveSuccessTitle"),
        message: t("settings.hru.notifications.saveSuccessMessage"),
        color: "green",
      });
    } catch (error) {
      logger.error("Failed to save HRU settings", { error });
      notifications.show({
        title: t("settings.hru.notifications.saveFailedTitle"),
        message: t("settings.hru.notifications.unknown"),
        color: "red",
      });
    } finally {
      setSaving(false);
    }
  }, [queryClient, settings, t]);

  const probe = useCallback(async () => {
    if (!settings.unit) {
      startTransition(() => {
        setProbeStatus("error");
        setProbeError(t("settings.hru.notifications.noUnitSelected"));
      });
      return;
    }
    clearProbe();
    setProbing(true);
    try {
      const res = await fetch(resolveApiUrl("/api/hru/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      startTransition(() => {
        if (res.ok) {
          setProbeStatus("success");
        } else {
          setProbeStatus("error");
          setProbeError(t("settings.hru.notifications.connectionFailed"));
        }
      });
    } catch (error) {
      logger.error("HRU probe failed", { error });
      startTransition(() => {
        setProbeStatus("error");
        setProbeError(t("settings.hru.notifications.connectionFailed"));
      });
    } finally {
      setProbing(false);
    }
  }, [settings, t]);

  const unitMissing = settings.unit === null || settings.unit === "";
  const hostMissing = settings.host.trim() === "";
  const portMissing = !Number.isFinite(settings.port) || settings.port <= 0;
  const unitIdMissing = !Number.isFinite(settings.unitId) || settings.unitId <= 0;

  const powerVar = selectedUnit?.variables?.find(
    (v) => v.class === "power" && (v.maxConfigurable || v.minConfigurable),
  );
  const powerUnitLabel =
    typeof powerVar?.unit === "string" ? powerVar.unit : (powerVar?.unit?.text ?? "%");
  const effectiveMaxPower = powerVar?.maxConfigurable
    ? (settings.maxPower ?? powerVar.maxDefault ?? powerVar.max)
    : powerVar?.max;
  const minPowerMissing =
    powerVar?.minConfigurable === true &&
    (settings.minPower === undefined || settings.minPower === null);
  const maxPowerMissing =
    powerVar?.maxConfigurable === true &&
    (settings.maxPower === undefined || settings.maxPower === null);
  const minAboveMax =
    powerVar?.minConfigurable === true &&
    settings.minPower != null &&
    effectiveMaxPower !== undefined &&
    settings.minPower > effectiveMaxPower;

  let minPowerError: string | undefined;
  if (minPowerMissing) {
    minPowerError = t("settings.hru.configuration.minPowerRequired");
  } else if (minAboveMax) {
    minPowerError = t("settings.hru.configuration.minPowerAboveMax");
  }

  return (
    <Accordion.Item value="hru">
      <Accordion.Control icon={<IconServer size={20} />}>
        <Text fw={600}>{t("settings.hru.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Paper p="md" withBorder radius="md">
          <Stack gap="md">
            <Text fw={500} size="md">
              {t("settings.hru.description")}
            </Text>
            <Text size="sm" c="blue" fs="italic">
              {t("settings.hru.saveBeforeProbeHint")}
            </Text>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <Select
                required
                data={unitOptions}
                value={settings.unit ?? ""}
                onChange={(v) => selectUnit(v === "" ? null : v)}
                label={t("settings.hru.unitLabel")}
                placeholder={t("settings.hru.unitPlaceholder")}
                error={unitMissing ? t("settings.hru.unitRequired") : undefined}
                disabled={loading}
                searchable
                clearable
                size="md"
              />
              <NumberInput
                required
                value={settings.port}
                onChange={(v) => {
                  const n = typeof v === "number" ? v : Number(v ?? 502);
                  update("port", Number.isFinite(n) ? n : 502);
                }}
                label={t("settings.hru.portLabel")}
                min={1}
                max={65535}
                step={1}
                error={portMissing ? t("settings.hru.portRequired") : undefined}
                size="md"
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              <TextInput
                required
                value={settings.host}
                onChange={(e) => update("host", e.target.value)}
                label={t("settings.hru.hostLabel")}
                placeholder="localhost"
                error={hostMissing ? t("settings.hru.hostRequired") : undefined}
                size="md"
              />
              <NumberInput
                required
                value={settings.unitId}
                onChange={(v) => {
                  const n = typeof v === "number" ? v : Number(v ?? 1);
                  update("unitId", Number.isFinite(n) ? n : 1);
                }}
                label={t("settings.hru.unitIdLabel")}
                min={1}
                max={247}
                step={1}
                error={unitIdMissing ? t("settings.hru.unitIdRequired") : undefined}
                size="md"
              />
            </SimpleGrid>

            {powerVar && (
              <Paper p="sm" withBorder radius="md" bg="var(--mantine-color-blue-light)">
                <Stack gap="xs">
                  <Text fw={500} size="sm">
                    {t("settings.hru.configuration.title")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {powerVar.minConfigurable
                      ? t("settings.hru.configuration.limitsDescription")
                      : t("settings.hru.configuration.maxPowerDescription")}
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    {powerVar.minConfigurable && (
                      <NumberInput
                        required
                        value={settings.minPower ?? powerVar.minDefault ?? powerVar.min}
                        onChange={(v) => update("minPower", typeof v === "number" ? v : undefined)}
                        label={t("settings.hru.configuration.minPowerLabel")}
                        description={t("settings.hru.configuration.minPowerHint", {
                          default: powerVar.minDefault ?? powerVar.min,
                          unit: powerUnitLabel,
                        })}
                        error={minPowerError}
                        min={powerVar.min ?? 0}
                        max={effectiveMaxPower ?? 10000}
                        size="md"
                      />
                    )}
                    {powerVar.maxConfigurable && (
                      <NumberInput
                        required
                        value={settings.maxPower ?? powerVar.maxDefault ?? powerVar.max}
                        onChange={(v) => update("maxPower", typeof v === "number" ? v : undefined)}
                        label={t("settings.hru.configuration.maxPowerLabel")}
                        description={t("settings.hru.configuration.maxPowerHint", {
                          default: powerVar.maxDefault ?? powerVar.max,
                          unit: powerUnitLabel,
                        })}
                        error={
                          maxPowerMissing
                            ? t("settings.hru.configuration.maxPowerRequired")
                            : undefined
                        }
                        min={1}
                        max={10000}
                        size="md"
                      />
                    )}
                  </SimpleGrid>
                </Stack>
              </Paper>
            )}

            <Group mt="sm">
              <Button
                onClick={save}
                loading={saving}
                disabled={loading || hostMissing || minAboveMax}
                size="md"
                variant="filled"
              >
                {t("settings.hru.save")}
              </Button>
              <Button
                onClick={probe}
                loading={probing}
                disabled={!settings.unit || loading || hostMissing}
                variant="light"
                size="md"
              >
                {t("settings.hru.probe")}
              </Button>
              {probeStatus === "success" && (
                <Badge color="green" variant="light">
                  {t("settings.hru.probeSuccess")}
                </Badge>
              )}
              {probeStatus === "error" && (
                <Badge color="red" variant="light">
                  {probeError || t("settings.hru.notifications.unknown")}
                </Badge>
              )}
            </Group>
          </Stack>
        </Paper>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
