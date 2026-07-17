import { ActionIcon, CopyButton, Group, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

export function CopyableValueCell({ value }: Readonly<{ value: string }>) {
  const { t } = useTranslation();

  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <Text size="sm" ff="monospace" style={{ whiteSpace: "pre-wrap" }}>
        {value}
      </Text>
      <CopyButton value={value} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip
            label={
              copied
                ? t("debug.copied", { defaultValue: "Copied" })
                : t("debug.copy", { defaultValue: "Copy" })
            }
            withArrow
          >
            <ActionIcon color={copied ? "teal" : "gray"} variant="subtle" size="sm" onClick={copy}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}
