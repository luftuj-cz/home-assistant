import { IconDownload, IconHelpCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "@luftuj/features/settings/components/SettingsSection";
import { useDownloadBugReport } from "@luftuj/features/settings/hooks/useDownloadBugReport";
import { Button } from "@luftuj/shared/ui/button";
import { TextLink } from "@luftuj/shared/ui/text-link";
import { Well } from "@luftuj/shared/ui/well";

const LUFTATOR_WEBSITE_URL = "https://www.luftator.eu";
const HRU_DOCUMENTATION_URL = "https://www.luftator.eu/docs/rekuperacni-jednotky";

/** Nápověda: the website, the bug-report download, common mistakes and the contact, as wells. */
export function HelpSection() {
  const { t } = useTranslation();
  const { download, loading } = useDownloadBugReport();

  return (
    <SettingsSection
      value="help"
      index="07"
      icon={IconHelpCircle}
      title={t("settings.help.title")}
      description={t("settings.help.description")}
    >
      <div className="grid grid-cols-2 gap-4 @max-[520px]:grid-cols-[minmax(0,1fr)]">
        <Well legend={t("settings.help.website.title")} className="content-start gap-3">
          <p className="body">{t("settings.help.website.description")}</p>
          <TextLink href={LUFTATOR_WEBSITE_URL} external className="justify-self-start">
            {t("settings.help.website.link")}
          </TextLink>
        </Well>
        <Well legend={t("settings.help.bugReport.title")} className="content-start gap-3">
          <p className="body">{t("settings.help.bugReport.description")}</p>
          <Button
            variant="secondary"
            icon={IconDownload}
            loading={loading}
            onClick={() => void download()}
            className="justify-self-start"
          >
            {t("settings.help.bugReport.download")}
          </Button>
        </Well>
      </div>
      <Well legend={t("settings.help.commonMistakes.title")}>
        <ul className="body m-0 grid list-disc gap-2 pl-5">
          <li>{t("settings.help.commonMistakes.mqttCredentials")}</li>
          <li>
            {t("settings.help.commonMistakes.modbusConnection.prefix")}{" "}
            <TextLink href={HRU_DOCUMENTATION_URL} external>
              {t("settings.help.commonMistakes.modbusConnection.link")}
            </TextLink>
          </li>
        </ul>
      </Well>
      <Well
        legend={t("settings.help.contact.title")}
        className="max-w-[calc(50%-8px)] @max-[520px]:max-w-none"
      >
        <p className="body">
          {t("settings.help.contact.prefix")}{" "}
          <TextLink href="mailto:info@luftuj.cz">info@luftuj.cz</TextLink>
        </p>
      </Well>
    </SettingsSection>
  );
}
