import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { translateConnectionError } from "@luftuj/shared/utils/connectionError";

const MIN_TOAST_INTERVAL_MS = 30_000;

interface ConnectionTransitionToastParams {
  connected: boolean | null;
  errorCode: string | null;
  errorMessage: string | null;
  namespace: "modbusErrors" | "mqttErrors";
  disconnectedTitleKey: string;
  reconnectedTitleKey: string;
  reconnectedMessageKey: string;
}

/**
 * Shows a toast on a meaningful connected<->disconnected transition, at most
 * once per MIN_TOAST_INTERVAL_MS so a flapping connection doesn't spam toasts.
 * A transition that arrives inside the window isn't dropped - it's deferred
 * and shown once the window clears, unless the state has since reverted back
 * to what was last announced (in which case there's nothing new to report).
 */
export function useConnectionTransitionToast(params: ConnectionTransitionToastParams): void {
  const {
    connected,
    errorCode,
    errorMessage,
    namespace,
    disconnectedTitleKey,
    reconnectedTitleKey,
    reconnectedMessageKey,
  } = params;
  const { t } = useTranslation();

  const errorRef = useRef({ code: errorCode, message: errorMessage });
  errorRef.current = { code: errorCode, message: errorMessage };

  const lastAnnouncedRef = useRef<boolean | null>(null);
  const lastToastAtRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (connected === null) return;
    if (lastAnnouncedRef.current === null) {
      lastAnnouncedRef.current = connected;
      return;
    }
    if (connected === lastAnnouncedRef.current) return;

    function announce() {
      pendingTimerRef.current = null;
      lastToastAtRef.current = Date.now();
      lastAnnouncedRef.current = connected;
      if (connected) {
        notifications.show({
          title: t(reconnectedTitleKey),
          message: t(reconnectedMessageKey),
          color: "green",
        });
      } else {
        notifications.show({
          title: t(disconnectedTitleKey),
          message: translateConnectionError(
            namespace,
            errorRef.current.code,
            errorRef.current.message,
            t,
          ),
          color: "red",
        });
      }
    }

    const elapsed = Date.now() - lastToastAtRef.current;
    if (elapsed >= MIN_TOAST_INTERVAL_MS) {
      announce();
    } else {
      pendingTimerRef.current = setTimeout(announce, MIN_TOAST_INTERVAL_MS - elapsed);
    }

    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [connected, namespace, disconnectedTitleKey, reconnectedTitleKey, reconnectedMessageKey, t]);
}
