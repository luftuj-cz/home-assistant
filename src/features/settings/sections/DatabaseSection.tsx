import { useState } from "react";
import { Accordion, Button, FileButton, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconDatabase, IconDownload, IconUpload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";

import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseApiError, translateApiError } from "@luftuj/shared/utils/apiError";
import { createLogger } from "@luftuj/shared/utils/logger";

const logger = createLogger("DatabaseSection");

export function DatabaseSection() {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);

  async function handleExport() {
    try {
      const response = await fetch(resolveApiUrl("/api/database/export"));
      if (!response.ok) {
        notifications.show({
          title: t("settings.database.notifications.exportFailedTitle"),
          message: t("settings.database.notifications.unknown"),
          color: "red",
        });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "luftator.db";
      link.click();
      URL.revokeObjectURL(url);
      notifications.show({
        title: t("settings.database.notifications.exportSuccessTitle"),
        message: t("settings.database.notifications.exportSuccessMessage"),
        color: "green",
      });
    } catch (err) {
      logger.error("Database export failed", { error: err });
      notifications.show({
        title: t("settings.database.notifications.exportFailedTitle"),
        message: t("settings.database.notifications.unknown"),
        color: "red",
      });
    }
  }

  async function handleImport(file: File | null) {
    if (!file) return;
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
        notifications.show({
          title: t("settings.database.notifications.importFailedTitle"),
          message: translateApiError(err, t),
          color: "red",
        });
        return;
      }
      notifications.show({
        title: t("settings.database.notifications.importSuccessTitle"),
        message: t("settings.database.notifications.importSuccessMessage"),
        color: "green",
      });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      logger.error("Database import failed", { error: err });
      notifications.show({
        title: t("settings.database.notifications.importFailedTitle"),
        message: t("settings.database.notifications.unknown"),
        color: "red",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Accordion.Item value="database">
      <Accordion.Control icon={<IconDatabase size={20} />}>
        <Text fw={600}>{t("settings.database.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Paper p="md" withBorder radius="md">
          <Stack gap="md">
            <Text fw={500} size="md">
              {t("settings.database.description")}
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <Button
                leftSection={<IconDownload size={20} />}
                onClick={handleExport}
                variant="light"
                size="md"
              >
                {t("settings.database.export")}
              </Button>
              <FileButton onChange={handleImport} accept=".db" disabled={uploading}>
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={20} />}
                    loading={uploading}
                    variant="filled"
                    size="md"
                  >
                    {uploading ? t("settings.database.importing") : t("settings.database.import")}
                  </Button>
                )}
              </FileButton>
            </SimpleGrid>
          </Stack>
        </Paper>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
