import { useState } from "react";
import { useTranslation } from "react-i18next";

import logoFullDark from "@luftuj/assets/logo-full-dark.svg";
import logoFullLight from "@luftuj/assets/logo-full-light.svg";
import { APP_VERSION } from "@luftuj/config";
import { ChangelogDialog } from "@luftuj/shared/ui/changelog-dialog";
import { Legend } from "@luftuj/shared/ui/legend";
import { TextLink } from "@luftuj/shared/ui/text-link";
import { VersionChip } from "@luftuj/shared/ui/version-chip";

const GITHUB_REPO_URL = "https://github.com/luftuj-cz/home-assistant";
const CHANGELOG_URL = `${GITHUB_REPO_URL}/blob/main/addon/CHANGELOG.md`;

const contactLink =
  "w-fit text-foreground no-underline transition-colors duration-(--duration-fast) hover:text-air";

/**
 * Company contact, address and logo, then the "about this add-on" row: GitHub and the version chip, which opens
 * "Co je nového". Desktop only: on a phone the footer is hidden (the dev tag in the header keeps the channel visible).
 */
export function AppFooter() {
  const { t } = useTranslation();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const companyLink = import.meta.env.VITE_FOOTER_LINK ?? "https://www.luftuj.cz/";

  return (
    <footer
      data-slot="app-footer"
      className="border-t border-border font-sans text-sm leading-5 max-md:hidden"
    >
      <div className="mx-auto grid max-w-[1328px] grid-cols-3 gap-6 px-6 pt-8 pb-6">
        {/* A little shorter than the contact and address columns beside it, centred on them; the SVG has no margins. */}
        <a
          href={companyLink}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit self-center"
        >
          <img
            src={logoFullLight}
            alt={t("app.footer.company")}
            height={50}
            className="h-[50px] w-auto dark:hidden"
          />
          <img
            src={logoFullDark}
            alt={t("app.footer.company")}
            height={50}
            className="hidden h-[50px] w-auto dark:block"
          />
        </a>
        <div className="grid content-start gap-1">
          <Legend>{t("app.footer.contact")}</Legend>
          <a href={t("app.footer.phoneLink")} className={contactLink}>
            {t("app.footer.phone")}
          </a>
          <a href={t("app.footer.emailLink")} className={contactLink}>
            {t("app.footer.email")}
          </a>
        </div>
        <div className="grid content-start gap-1">
          <Legend>{t("app.footer.location")}</Legend>
          <span>{t("app.footer.addressLine1")}</span>
          <span className="text-muted-foreground">{t("app.footer.addressLine2")}</span>
        </div>
        <div className="col-span-3 flex flex-wrap items-center justify-between gap-4 border-t border-dashed border-border pt-4">
          <span className="caption text-muted-foreground">
            © {new Date().getFullYear()} {t("app.footer.company")}.{" "}
            {t("app.footer.allRightsReserved")}
          </span>
          <span className="inline-flex items-center gap-4">
            <TextLink href={GITHUB_REPO_URL} external className="text-[13px]">
              {t("app.footer.github")}
            </TextLink>
            <VersionChip version={APP_VERSION} onClick={() => setChangelogOpen(true)} />
          </span>
        </div>
      </div>
      <ChangelogDialog
        open={changelogOpen}
        onOpenChange={setChangelogOpen}
        current={APP_VERSION}
        url={CHANGELOG_URL}
      />
    </footer>
  );
}
