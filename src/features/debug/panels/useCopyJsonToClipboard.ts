import { useState } from "react";
import type { Logger } from "@luftuj/shared/utils/logger";

export function useCopyJsonToClipboard(logger: Logger) {
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(data: unknown): Promise<void> {
    if (data === null || data === undefined) {
      setStatus("failed");
      return;
    }

    setCopying(true);
    try {
      const text = JSON.stringify(data, null, 2);
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch (error) {
      logger.error("Clipboard copy failed", { error });
      setStatus("failed");
    } finally {
      setCopying(false);
    }
  }

  return { copying, status, copy };
}
