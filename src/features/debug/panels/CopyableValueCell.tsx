import { useState } from "react";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { writeTextToClipboard } from "@luftuj/shared/utils/clipboard";

export function CopyableValueCell({ value }: Readonly<{ value: string }>) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await writeTextToClipboard(value);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard copy was cancelled or failed; leave the icon in its default state
    }
  }

  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <Text size="sm" ff="monospace" style={{ whiteSpace: "pre-wrap" }}>
        {value}
      </Text>
      <Tooltip
        label={
          copied
            ? t("debug.copied", { defaultValue: "Copied" })
            : t("debug.copy", { defaultValue: "Copy" })
        }
        withArrow
      >
        <ActionIcon
          color={copied ? "teal" : "gray"}
          variant="subtle"
          size="sm"
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
