import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { triggerBlobDownload } from "@luftuj/shared/utils/download";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("useDownloadBugReport");

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const match = /filename="?([^";]+)"?/.exec(header);
  return match?.[1] ?? fallback;
}

export function useDownloadBugReport() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function download(): Promise<void> {
    setLoading(true);
    try {
      const response = await fetch(resolveApiUrl("/api/support/bundle"));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(
        response.headers.get("content-disposition"),
        "luftator-bugreport.zip",
      );
      triggerBlobDownload(blob, filename);
      notifications.show({
        title: t("settings.help.bugReport.successTitle"),
        message: t("settings.help.bugReport.successMessage"),
        color: "green",
      });
    } catch (error) {
      logger.error("Bug report download failed", { error });
      notifications.show({
        title: t("settings.help.bugReport.errorTitle"),
        message: t("settings.help.bugReport.errorMessage"),
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  }

  return { download, loading };
}
