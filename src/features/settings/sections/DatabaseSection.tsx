import { IconDatabase, IconDownload, IconUpload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSection, SummaryChip } from "@luftuj/features/settings/components/SettingsSection";
import { Button } from "@luftuj/shared/ui/button";
import { FileButton } from "@luftuj/shared/ui/file-button";
import { notify } from "@luftuj/shared/ui/notify";
import { Well } from "@luftuj/shared/ui/well";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError, translateApiError } from "@luftuj/shared/utils/apiError";
import { triggerBlobDownload } from "@luftuj/shared/utils/download";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("DatabaseSection");

/** "184 KiB", "2,4 MiB". */
function formatSize(bytes: number, language: string) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  const mib = (bytes / (1024 * 1024)).toLocaleString(language, { maximumFractionDigits: 1 });
  return `${mib} MiB`;
}

/** Text with `code` spans, as the description strings write paths. */
function withCode(text: string) {
  return text.split("`").map((part, index) =>
    index % 2 === 1 ? (
      <code key={part} className="code rounded-sm bg-muted px-1">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** Nástroje databáze: export and import as two wells; the closed section shows the database size. */
export function DatabaseSection() {
  const { t, i18n } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const { data: info } = useQuery({
    queryKey: ["database-info"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/database/info"));
      if (!res.ok) return null;
      return (await res.json()) as { sizeBytes: number };
    },
    staleTime: 60_000,
  });

  async function handleExport() {
    try {
      const response = await fetch(resolveApiUrl("/api/database/export"));
      if (!response.ok) {
        notify({
          title: t("settings.database.notifications.exportFailedTitle"),
          message: t("settings.database.notifications.unknown"),
          variant: "error",
        });
        return;
      }
      const blob = await response.blob();
      triggerBlobDownload(blob, "luftator.db");
      notify({
        title: t("settings.database.notifications.exportSuccessTitle"),
        message: t("settings.database.notifications.exportSuccessMessage"),
        variant: "success",
      });
    } catch (err) {
      logger.error("Database export failed", { error: err });
      notify({
        title: t("settings.database.notifications.exportFailedTitle"),
        message: t("settings.database.notifications.unknown"),
        variant: "error",
      });
    }
  }

  async function handleImport(file: File) {
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch(resolveApiUrl("/api/database/import"), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });
      if (!res.ok) {
        const err = await parseApiError(res);
        notify({
          title: t("settings.database.notifications.importFailedTitle"),
          message: translateApiError(err, t),
          variant: "error",
        });
        return;
      }
      notify({
        title: t("settings.database.notifications.importSuccessTitle"),
        message: t("settings.database.notifications.importSuccessMessage"),
        variant: "success",
      });
      setTimeout(() => globalThis.location.reload(), 1500);
    } catch (err) {
      logger.error("Database import failed", { error: err });
      notify({
        title: t("settings.database.notifications.importFailedTitle"),
        message: t("settings.database.notifications.unknown"),
        variant: "error",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <SettingsSection
      value="database"
      index="06"
      icon={IconDatabase}
      title={t("settings.database.title")}
      description={t("settings.database.sectionDescription")}
      summary={
        info ? <SummaryChip>{formatSize(info.sizeBytes, i18n.language)}</SummaryChip> : undefined
      }
    >
      <p className="body text-muted-foreground">{withCode(t("settings.database.description"))}</p>
      <div className="grid grid-cols-2 gap-4 @max-[520px]:grid-cols-[minmax(0,1fr)]">
        <Well legend={t("settings.database.backup.legend")} className="content-start gap-3">
          <p className="body">{t("settings.database.backup.description")}</p>
          <Button
            variant="secondary"
            icon={IconDownload}
            onClick={() => void handleExport()}
            className="justify-self-start"
          >
            {t("settings.database.export")}
          </Button>
        </Well>
        <Well legend={t("settings.database.restore.legend")} className="content-start gap-3">
          <p className="body">{t("settings.database.restore.description")}</p>
          <FileButton
            accept=".db"
            variant="secondary"
            icon={IconUpload}
            disabled={uploading}
            onFile={(file) => void handleImport(file)}
            className="justify-self-start"
          >
            {uploading ? t("settings.database.importing") : t("settings.database.import")}
          </FileButton>
        </Well>
      </div>
    </SettingsSection>
  );
}
