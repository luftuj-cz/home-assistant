import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { parseChangelog, parseVersion, type ChangelogEntry } from "@luftuj/shared/utils/changelog";
import { cn } from "@luftuj/shared/utils/cn";

import { Alert } from "./alert";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "./dialog";
import type { Tone } from "./dot";
import { Legend } from "./legend";
import { Spinner } from "./spinner";
import { TextLink } from "./text-link";
import { channelTone } from "./version-chip";

const SECTION_TONE: Record<string, Tone> = {
  Added: "success",
  Changed: "air",
  Fixed: "manual",
  Removed: "destructive",
  Deprecated: "warning",
  Security: "destructive",
  Thanks: "neutral",
};

/** Links, `code` and **bold** from a changelog line; everything else stays text. */
function inlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (at > last) {
      parts.push(text.slice(last, at));
    }
    if (match[1]) {
      parts.push(
        <TextLink key={at} href={match[2]} external>
          {match[1]}
        </TextLink>,
      );
    } else if (match[3]) {
      parts.push(
        <code key={at} className="code">
          {match[3]}
        </code>,
      );
    } else {
      parts.push(
        <b key={at} className="font-medium text-foreground">
          {match[4]}
        </b>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

/** The release notes, newest first; the installed release is marked. Entries stay in English, as written. */
function Changelog({ entries, current }: Readonly<{ entries: ChangelogEntry[]; current: string }>) {
  const { t, i18n } = useTranslation();
  const installed = parseVersion(current).version;
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });

  return (
    <div className="grid gap-6">
      {entries.map((entry) => (
        <section
          key={entry.raw}
          className="grid gap-3 [&+&]:border-t [&+&]:border-border [&+&]:pt-6"
        >
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="font-sans text-[17px] leading-6 font-semibold tracking-[-.01em] tabular-nums">
              {entry.unreleased ? t("app.changelog.unreleased") : `v${entry.version}`}
            </h3>
            {!entry.unreleased && (
              <span
                className={cn(
                  "inline-flex h-5 items-center rounded-sm px-2 font-mono text-[11px] leading-none tracking-[.04em]",
                  channelTone(entry.channel),
                )}
              >
                {entry.channel}
              </span>
            )}
            {entry.version === installed && (
              <Badge variant="air">{t("app.changelog.installed")}</Badge>
            )}
            {entry.date && (
              <span className="caption ml-auto text-muted-foreground">
                {dateFormat.format(new Date(`${entry.date}T12:00:00`))}
              </span>
            )}
          </header>
          {entry.sections.map((section) => (
            <div key={section.type} className="grid gap-1.5">
              <Legend tone={SECTION_TONE[section.type] ?? "neutral"}>
                {t(`app.changelog.sections.${section.type}`, { defaultValue: section.type })}
              </Legend>
              <ul className="m-0 grid list-disc gap-1.5 pl-[18px] marker:text-input">
                {section.items.map((item, index) => (
                  <li
                    key={index}
                    className="font-sans text-sm leading-[21px] break-words text-muted-foreground [overflow-wrap:anywhere]"
                  >
                    {item.area && <b className="font-medium text-foreground">{item.area}: </b>}
                    {inlineMarkdown(item.text)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The full APP_VERSION. */
  current: string;
  /** Link to the full history. */
  url?: string;
}

/**
 * "Co je nového": addon/CHANGELOG.md, loaded only when the dialog opens (it is not part of the main bundle). A dev
 * build that is not in the list gets a warning first.
 */
export function ChangelogDialog({
  open,
  onOpenChange,
  current,
  url,
}: Readonly<ChangelogDialogProps>) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const { version, channel } = parseVersion(current);

  useEffect(() => {
    if (!open || entries) {
      return;
    }
    let active = true;
    void import("../../../addon/CHANGELOG.md?raw").then((module) => {
      if (active) {
        setEntries(parseChangelog(module.default));
      }
    });
    return () => {
      active = false;
    };
  }, [open, entries]);

  const unlisted =
    entries !== null && channel !== "stable" && !entries.some((e) => e.version === version);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" scroll>
        <DialogHeader
          title={t("app.changelog.title")}
          description={t("app.changelog.installedVersion", { version, channel })}
        />
        <DialogBody>
          {entries === null ? (
            <Spinner />
          ) : (
            <>
              {unlisted && (
                <Alert variant="warning" title={t("app.changelog.devTitle")}>
                  {t("app.changelog.devText")}
                </Alert>
              )}
              <Changelog entries={entries} current={current} />
            </>
          )}
        </DialogBody>
        <DialogFooter
          start={
            url ? (
              <TextLink href={url} external>
                {t("app.changelog.fullHistory")}
              </TextLink>
            ) : undefined
          }
        >
          <DialogClose asChild>
            <Button variant="secondary">{t("ui.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
