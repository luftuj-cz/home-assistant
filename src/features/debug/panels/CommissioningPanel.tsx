import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconPlayerPlay, IconPlayerStop } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("CommissioningPanel");

interface Mode {
  id: number;
  name: string;
}

interface CommissioningStatus {
  running: boolean;
  modeId?: number;
  modeName?: string;
  index?: number;
  total?: number;
  secondsRemaining?: number;
  intervalSeconds?: number;
}

export function CommissioningPanel() {
  const { t } = useTranslation();
  const [modes, setModes] = useState<Mode[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [intervalSeconds, setIntervalSeconds] = useState<number>(45);
  const [status, setStatus] = useState<CommissioningStatus>({ running: false });
  const [loading, setLoading] = useState(false);
  const [modesLoading, setModesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(resolveApiUrl("/api/commissioning/run"), { cache: "no-cache" });
      if (res.ok) {
        const data = (await res.json()) as CommissioningStatus;
        setStatus(data);
        if (!data.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err) {
      logger.debug("Commissioning status poll failed", { err });
    }
  }, []);

  useEffect(() => {
    async function loadModes() {
      setModesLoading(true);
      try {
        const res = await fetch(resolveApiUrl("/api/timeline/modes"), { cache: "no-cache" });
        if (res.ok) {
          const { modes: data } = (await res.json()) as { modes: Mode[] };
          if (mountedRef.current) {
            setModes(data);
            setSelectedIds(new Set(data.map((m) => m.id)));
          }
        } else if (mountedRef.current) {
          setError(`Failed to load modes: HTTP ${res.status}`);
        }
      } catch (err) {
        logger.warn("Failed to load commissioning modes", { err });
        if (mountedRef.current) setError(String(err));
      } finally {
        setModesLoading(false);
      }
    }

    async function init() {
      await loadModes();
      const res = await fetch(resolveApiUrl("/api/commissioning/run"), { cache: "no-cache" });
      if (res.ok) {
        const data = (await res.json()) as CommissioningStatus;
        if (mountedRef.current) {
          setStatus(data);
          if (data.running) {
            startPolling();
          }
        }
      }
    }

    void init();
  }, []);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void fetchStatus();
    }, 1000);
  }

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleStart() {
    setError(null);
    setLoading(true);
    try {
      const selectedModes = modes.filter((m) => selectedIds.has(m.id));
      const body = {
        intervalSeconds,
        modeIds: selectedModes.map((m) => m.id),
      };
      const res = await fetch(resolveApiUrl("/api/commissioning/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = (await res.json()) as CommissioningStatus;
        setStatus(data);
        startPolling();
      } else {
        const text = await res.text();
        setError(text || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl("/api/commissioning/run"), { method: "DELETE" });
      if (res.ok) {
        const data = (await res.json()) as CommissioningStatus;
        setStatus(data);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else {
        const text = await res.text();
        setError(text || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleMode(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (modes.length === 0) return;
    if (selectedIds.size === modes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(modes.map((m) => m.id)));
    }
  }

  let modeListContent: ReactNode;
  if (modesLoading) {
    modeListContent = (
      <Text size="sm" c="dimmed">
        {t("debug.commissioning.loadingModes")}
      </Text>
    );
  } else if (modes.length === 0) {
    modeListContent = (
      <Text size="sm" c="dimmed">
        {t("debug.commissioning.noModes")}
      </Text>
    );
  } else {
    modeListContent = (
      <Stack gap={4}>
        {modes.map((m) => (
          <Checkbox
            key={m.id}
            label={m.name}
            checked={selectedIds.has(m.id)}
            onChange={() => toggleMode(m.id)}
            disabled={status.running}
          />
        ))}
      </Stack>
    );
  }

  const progressPct =
    status.running && status.total && status.intervalSeconds
      ? ((status.intervalSeconds - (status.secondsRemaining ?? 0)) / status.intervalSeconds) * 100
      : 0;

  const overallPct =
    status.running && status.total ? ((status.index ?? 0) / status.total) * 100 : 0;

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={4}>{t("debug.commissioning.title")}</Title>
        <Text c="dimmed" size="sm">
          {t("debug.commissioning.description")}
        </Text>
      </Stack>

      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          onClose={() => setError(null)}
          withCloseButton
        >
          {error}
        </Alert>
      )}

      {status.running && (
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600} size="sm">
              {t("debug.commissioning.currentMode")}
            </Text>
            <Badge size="lg" variant="filled">
              {status.modeName ?? "—"}
            </Badge>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {t("debug.commissioning.step", {
                current: (status.index ?? 0) + 1,
                total: status.total ?? 0,
              })}
            </Text>
            <Text size="sm" fw={500}>
              {t("debug.commissioning.secondsRemaining", { seconds: status.secondsRemaining ?? 0 })}
            </Text>
          </Group>
          <Progress value={progressPct} size="md" animated />
          <Progress value={overallPct} size="xs" color="gray" />
        </Stack>
      )}

      <Group align="flex-end" gap="md">
        <NumberInput
          label={t("debug.commissioning.intervalLabel")}
          description={t("debug.commissioning.intervalDescription")}
          value={intervalSeconds}
          onChange={(v) => setIntervalSeconds(typeof v === "number" ? v : 45)}
          min={10}
          max={300}
          step={5}
          suffix=" s"
          w={160}
          disabled={status.running}
        />

        {status.running ? (
          <Button
            color="red"
            leftSection={<IconPlayerStop size={16} />}
            loading={loading}
            onClick={() => {
              void handleStop();
            }}
          >
            {t("debug.commissioning.stop")}
          </Button>
        ) : (
          <Button
            color="teal"
            leftSection={<IconPlayerPlay size={16} />}
            loading={loading || modesLoading}
            disabled={selectedIds.size === 0}
            onClick={() => {
              void handleStart();
            }}
          >
            {t("debug.commissioning.start")}
          </Button>
        )}
      </Group>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            {t("debug.commissioning.modesLabel")}
          </Text>
          <Button
            variant="subtle"
            size="xs"
            onClick={toggleAll}
            disabled={status.running || modesLoading}
          >
            {selectedIds.size === modes.length
              ? t("debug.commissioning.deselectAll")
              : t("debug.commissioning.selectAll")}
          </Button>
        </Group>

        {modeListContent}
      </Stack>
    </Stack>
  );
}
