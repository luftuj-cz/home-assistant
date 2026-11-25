import { useState } from "react";
import type { TFunction } from "i18next";
import { notify } from "@luftuj/shared/ui/notify";
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
        notify({
          title: t("debug.downloadValuesFailedTitle", { defaultValue: "Download failed" }),
          message: t("debug.downloadValuesFailed", {
            defaultValue: "Failed to download debug values: HTTP {{status}}",
            status: response.status,
          }),
          variant: "error",
        });
        return;
      }

      const blob = await response.blob();
      triggerBlobDownload(blob, `${filenamePrefix}-${Date.now()}.json`);
    } catch (error) {
      logger.error("Debug values download failed", { error });
      notify({
        title: t("debug.downloadValuesFailedTitle", { defaultValue: "Download failed" }),
        message: t("debug.downloadValuesFailedUnknown", {
          defaultValue: "Failed to download debug values.",
        }),
        variant: "error",
      });
    } finally {
      setDownloading(false);
    }
  }

  return { downloading, download };
}
