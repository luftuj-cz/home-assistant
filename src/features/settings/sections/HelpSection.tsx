import { IconBook, IconDownload, IconFileZip, IconHelpCircle, IconMail } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "@luftuj/features/settings/components/SettingsSection";
import { useDownloadBugReport } from "@luftuj/features/settings/hooks/useDownloadBugReport";
import { Button } from "@luftuj/shared/ui/button";
import { ICON_STROKE, type IconComponent } from "@luftuj/shared/ui/icon-types";
import { IconModbus } from "@luftuj/shared/ui/icons";
import { TextLink } from "@luftuj/shared/ui/text-link";

const LUFTATOR_WEBSITE_URL = "https://www.luftator.eu";
const HRU_DOCUMENTATION_URL = "https://www.luftator.eu/docs/rekuperacni-jednotky";
const SUPPORT_EMAIL = "info@luftuj.cz";

interface HelpRowProps {
  icon: IconComponent;
  title: string;
  description: string;
  action: ReactNode;
}

/** One way to get help, laid out like a row of Služby on Přehled: icon tile, title and line, the action at the end. */
function HelpRow({ icon: Icon, title, description, action }: Readonly<HelpRowProps>) {
  return (
    <li className="flex items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0 @max-[520px]:flex-wrap">
      <span className="grid size-9 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon size={20} stroke={ICON_STROKE} aria-hidden />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="label">{title}</p>
        <p className="caption text-muted-foreground">{description}</p>
      </div>
      {/* Narrow section: under the text, in line with it (past the 36px tile and its 12px gap). */}
      <div className="flex-none @max-[520px]:w-full @max-[520px]:pl-12">{action}</div>
    </li>
  );
}

/**
 * Nápověda: where to find help (documentation, the unit guide, the data for support, the e-mail) as rows like the
 * Služby card on Přehled.
 */
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
      <ul className="m-0 flex list-none flex-col p-0">
        <HelpRow
          icon={IconBook}
          title={t("settings.help.docs.title")}
          description={t("settings.help.docs.description")}
          action={
            <TextLink href={LUFTATOR_WEBSITE_URL} external>
              {t("settings.help.docs.link")}
            </TextLink>
          }
        />
        <HelpRow
          icon={IconModbus}
          title={t("settings.help.hruDocs.title")}
          description={t("settings.help.hruDocs.description")}
          action={
            <TextLink href={HRU_DOCUMENTATION_URL} external>
              {t("settings.help.hruDocs.link")}
            </TextLink>
          }
        />
        <HelpRow
          icon={IconFileZip}
          title={t("settings.help.bugReport.title")}
          description={t("settings.help.bugReport.description")}
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={IconDownload}
              loading={loading}
              onClick={() => void download()}
            >
              {t("settings.help.bugReport.download")}
            </Button>
          }
        />
        <HelpRow
          icon={IconMail}
          title={t("settings.help.contact.title")}
          description={t("settings.help.contact.description")}
          action={<TextLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</TextLink>}
        />
      </ul>
    </SettingsSection>
  );
}
