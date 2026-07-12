import { useState } from "react";
import type { TFunction } from "i18next";
import { notifications } from "@mantine/notifications";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { triggerBlobDownload } from "@luftuj/shared/utils/download";
import type { Logger } from "@luftuj/shared/utils/logger";

export function useDownloadDebugJson(logger: Logger, t: TFunction) {
  const [downloading, setDownloading] = useState(false);

  async function download(endpoint: string, filenamePrefix: string): Promise<void> {
    setDownloading(true);
    try {
      const response = await fetch(resolveApiUrl(endpoint));
      if (!response.ok) {
        notifications.show({
          title: t("debug.downloadValuesFailedTitle", { defaultValue: "Download failed" }),
          message: t("debug.downloadValuesFailed", {
            defaultValue: "Failed to download debug values: HTTP {{status}}",
            status: response.status,
          }),
          color: "red",
        });
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload(blob, `${filenamePrefix}-${Date.now()}.json`);
    } catch (error) {
      logger.error("Debug values download failed", { error });
      notifications.show({
        title: t("debug.downloadValuesFailedTitle", { defaultValue: "Download failed" }),
        message: t("debug.downloadValuesFailedUnknown", {
          defaultValue: "Failed to download debug values.",
        }),
        color: "red",
      });
    } finally {
      setDownloading(false);
    }
  }

  return { downloading, download };
}
