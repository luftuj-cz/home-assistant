import { IconRss } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SaveBar } from "@luftuj/features/settings/components/SaveBar";
import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import { Collapse } from "@luftuj/shared/ui/collapse";
import { ConnectionTest, type ConnectionTestState } from "@luftuj/shared/ui/connection-test";
import { Field } from "@luftuj/shared/ui/field";
import { Input } from "@luftuj/shared/ui/input";
import { notify } from "@luftuj/shared/ui/notify";
import { NumberInput } from "@luftuj/shared/ui/number-input";
import { Switch } from "@luftuj/shared/ui/switch";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError, translateApiError } from "@luftuj/shared/utils/apiError";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("MqttSection");

interface MqttSettings {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
}

const initial: MqttSettings = { enabled: false, host: "", port: 1883, user: "", password: "" };

/** The broker connection for the summary chip, from the backend's status. */
function useMqttConnected() {
  const { data } = useQuery({
    queryKey: ["status", "settings-summary-mqtt"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/status"));
      if (!res.ok) return null;
      return (await res.json()) as { mqtt?: { connection?: string } };
    },
    refetchInterval: 15_000,
  });
  return data?.mqtt?.connection === "connected";
}

/**
 * Integrace MQTT: the enable switch, then broker host and port, user and password (with reveal), the connection
 * test (with the form's values) and the SaveBar.
 */
export function MqttSection() {
  const { t } = useTranslation();
  const connected = useMqttConnected();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<MqttSettings>(initial);
  const [saved, setSaved] = useState<MqttSettings>(initial);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<ConnectionTestState>("idle");
  const [testError, setTestError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const res = await fetch(resolveApiUrl("/api/settings/mqtt"), { cache: "no-cache" });
        if (!res.ok || canceled) return;
        const data = await res.json();
        const loaded: MqttSettings = {
          enabled: !!data.enabled,
          host: data.host || "",
          port: data.port || 1883,
          user: data.user || "",
          password: data.password || "",
        };
        setSettings(loaded);
        setSaved(loaded);
      } catch (err) {
        logger.error("Failed to load MQTT settings", { error: err });
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, []);

  function update<K extends keyof MqttSettings>(key: K, value: MqttSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setTest("idle");
    setTestError(null);
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch(resolveApiUrl("/api/settings/mqtt"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        notify({
          title: t("settings.mqtt.notifications.saveFailedTitle"),
          message: translateApiError(err, t),
          variant: "error",
        });
        return false;
      }
      setSaved(settings);
      return true;
    } catch (err) {
      logger.error("Failed to save MQTT settings", { error: err });
      notify({
        title: t("settings.mqtt.notifications.saveFailedTitle"),
        message: t("settings.mqtt.notifications.unknown"),
        variant: "error",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTestError(null);
    setTest("testing");
    try {
      const res = await fetch(resolveApiUrl("/api/settings/mqtt/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        setTestError({ message: translateApiError(err, t), code: err.code });
        setTest("error");
        return;
      }
      setTest("success");
    } catch (err) {
      logger.error("MQTT connection test failed", { error: err });
      setTestError({ message: t("settings.mqtt.notifications.unknown") });
      setTest("error");
    }
  }

  const hostMissing = settings.enabled && settings.host.trim() === "";
  const portInvalid = settings.port <= 0 || settings.port > 65535;
  const dirty = !loading && JSON.stringify(settings) !== JSON.stringify(saved);

  let summary = <SummaryChip>{t("settings.mqtt.state.off")}</SummaryChip>;
  if (saved.enabled) {
    summary = connected ? (
      <SummaryChip tone="success">{t("settings.mqtt.state.connected")}</SummaryChip>
    ) : (
      <SummaryChip tone="destructive">{t("settings.mqtt.state.disconnected")}</SummaryChip>
    );
  }

  return (
    <SettingsSection
      value="mqtt"
      index="05"
      icon={IconRss}
      title={t("settings.mqtt.title")}
      description={t("settings.mqtt.sectionDescription")}
      dirty={dirty}
      summary={summary}
    >
      <Switch
        label={t("settings.mqtt.enabled")}
        description={t("settings.mqtt.description")}
        checked={settings.enabled}
        onCheckedChange={(checked) => update("enabled", checked)}
        disabled={loading}
      />
      <Collapse open={settings.enabled}>
        <div className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_130px] gap-4 @max-[420px]:grid-cols-[minmax(0,1fr)]">
            <Field
              label={t("settings.mqtt.host")}
              required
              error={hostMissing ? t("settings.mqtt.hostRequired") : undefined}
            >
              <Input
                value={settings.host}
                onChange={(event) => update("host", event.target.value)}
                placeholder="core-mosquitto"
                className="font-mono"
                spellCheck={false}
              />
            </Field>
            <Field
              label={t("settings.mqtt.port")}
              error={portInvalid ? t("settings.mqtt.portInvalid") : undefined}
            >
              <NumberInput
                value={settings.port}
                min={1}
                max={65535}
                onValueChange={(value) => update("port", value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 @max-[420px]:grid-cols-[minmax(0,1fr)]">
            <Field label={t("settings.mqtt.user")}>
              <Input
                value={settings.user}
                onChange={(event) => update("user", event.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label={t("settings.mqtt.password")}>
              <Input
                type="password"
                value={settings.password}
                onChange={(event) => update("password", event.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
        </div>
      </Collapse>
      <div className="border-t border-border pt-4">
        <ConnectionTest
          state={test}
          onTest={() => void runTest()}
          disabled={loading || settings.host.trim() === ""}
          hint={t("settings.testFormHint")}
          error={testError?.message}
          code={testError?.code}
          detail={`${settings.host}:${settings.port}`}
        />
      </div>
      <SaveBar
        dirty={dirty}
        saving={saving}
        disabled={hostMissing || portInvalid}
        label={t("settings.mqtt.save")}
        onSave={save}
        onDiscard={() => {
          setSettings(saved);
          setTest("idle");
          setTestError(null);
        }}
      />
    </SettingsSection>
  );
}
