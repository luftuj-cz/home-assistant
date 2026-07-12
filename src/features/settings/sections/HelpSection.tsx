import { Accordion, Anchor, List, Paper, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconExternalLink, IconHelpCircle, IconInfoCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

const LUFTATOR_WEBSITE_URL = "https://www.luftator.eu";
const HRU_DOCUMENTATION_URL = "https://www.luftator.eu/docs/rekuperacni-jednotky";

export function HelpSection() {
  const { t } = useTranslation();

  return (
    <Accordion.Item value="help">
      <Accordion.Control icon={<IconHelpCircle size={20} />}>
        <Text fw={600}>{t("settings.help.title")}</Text>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="lg">
          <Paper p="md" withBorder radius="md">
            <Stack gap="xs">
              <Text fw={500}>{t("settings.help.website.title")}</Text>
              <Text size="sm" c="dimmed">
                {t("settings.help.website.description")}
              </Text>
              <Anchor href={LUFTATOR_WEBSITE_URL} target="_blank" rel="noreferrer" w="fit-content">
                {t("settings.help.website.link")} <IconExternalLink size={14} />
              </Anchor>
            </Stack>
          </Paper>

          <Paper p="md" withBorder radius="md">
            <Stack gap="sm">
              <Text fw={500}>{t("settings.help.commonMistakes.title")}</Text>
              <List
                spacing="xs"
                icon={
                  <ThemeIcon color="yellow" size={20} radius="xl">
                    <IconInfoCircle size={14} />
                  </ThemeIcon>
                }
              >
                <List.Item>{t("settings.help.commonMistakes.mqttCredentials")}</List.Item>
                <List.Item>
                  {t("settings.help.commonMistakes.modbusConnection.prefix")}{" "}
                  <Anchor href={HRU_DOCUMENTATION_URL} target="_blank" rel="noreferrer">
                    {t("settings.help.commonMistakes.modbusConnection.link")}
                  </Anchor>
                </List.Item>
              </List>
              <Text size="sm" c="dimmed">
                {t("settings.help.contact.prefix")}{" "}
                <Anchor href="mailto:info@luftuj.cz">info@luftuj.cz</Anchor>
              </Text>
            </Stack>
          </Paper>
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
