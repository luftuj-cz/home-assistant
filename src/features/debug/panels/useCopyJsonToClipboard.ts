import { useState } from "react";
import type { TFunction } from "i18next";
import { notifications } from "@mantine/notifications";
import type { Logger } from "@luftuj/shared/utils/logger";
import { writeTextToClipboard } from "@luftuj/shared/utils/clipboard";

export function useCopyJsonToClipboard(logger: Logger, t: TFunction) {
  const [copying, setCopying] = useState(false);

  async function copy(data: unknown): Promise<void> {
    if (data === null || data === undefined) {
      notifications.show({
        title: t("debug.copyFailedTitle", { defaultValue: "Copy failed" }),
        message: t("debug.copyFailed", { defaultValue: "Failed to copy debug values." }),
        color: "red",
      });
      return;
    }

    setCopying(true);
    try {
      const text = JSON.stringify(data, null, 2);
      await writeTextToClipboard(text);
      notifications.show({
        title: t("debug.copySuccessTitle", { defaultValue: "Copied" }),
        message: t("debug.copySuccess", { defaultValue: "Debug values copied to clipboard." }),
        color: "teal",
      });
    } catch (error) {
      logger.error("Clipboard copy failed", { error });
      notifications.show({
        title: t("debug.copyFailedTitle", { defaultValue: "Copy failed" }),
        message: t("debug.copyFailed", { defaultValue: "Failed to copy debug values." }),
        color: "red",
      });
    } finally {
      setCopying(false);
    }
  }

  return { copying, copy };
}
