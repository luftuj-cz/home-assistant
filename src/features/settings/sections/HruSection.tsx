import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
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
import { useTranslation } from "react-i18next";

import type { HruUnit } from "../../../shared/api/hru";
import { resolveApiUrl } from "../../../shared/utils/api";
import { parseApiError, translateApiError } from "../../../shared/utils/apiError";
import { createLogger } from "../../../shared/utils/logger";

const logger = createLogger("HruSection");

interface HruSettings {
  unit: string | null;
  host: string;
  port: number;
  unitId: number;
  maxPower: number | undefined;
}

const initial: HruSettings = {
  unit: null,
  host: "localhost",
  port: 502,
  unitId: 1,
  maxPower: undefined,
};

export function HruSection() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [units, setUnits] = useState<HruUnit[]>([]);
  const [settings, setSettings] = useState<HruSettings>(initial);
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
        if (settingsRes.ok) setSettings(await settingsRes.json());
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
  }, [settings, t]);

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
        if (!res.ok) {
          setProbeStatus("error");
          setProbeError(t("settings.hru.notifications.connectionFailed"));
        } else {
          setProbeStatus("success");
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

  const powerVar = selectedUnit?.variables?.find((v) => v.class === "power" && v.maxConfigurable);

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
                onChange={(v) => update("unit", v === "" ? null : v)}
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
                    {t("settings.hru.configuration.maxPowerDescription")}
                  </Text>
                  <NumberInput
                    required
                    value={settings.maxPower ?? powerVar.maxDefault ?? powerVar.max}
                    onChange={(v) => update("maxPower", typeof v === "number" ? v : undefined)}
                    label={t("settings.hru.configuration.maxPowerLabel")}
                    description={t("settings.hru.configuration.maxPowerHint", {
                      default: powerVar.maxDefault ?? powerVar.max,
                      unit:
                        typeof powerVar.unit === "string"
                          ? powerVar.unit
                          : (powerVar.unit?.text ?? "%"),
                    })}
                    error={
                      settings.maxPower === undefined || settings.maxPower === null
                        ? t("settings.hru.configuration.maxPowerRequired")
                        : undefined
                    }
                    min={1}
                    max={10000}
                    size="md"
                  />
                </Stack>
              </Paper>
            )}

            <Group mt="sm">
              <Button
                onClick={save}
                loading={saving}
                disabled={loading || hostMissing}
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
