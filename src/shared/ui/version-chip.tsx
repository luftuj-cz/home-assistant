import { IconDownload } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { parseVersion } from "@luftuj/shared/utils/changelog";
import { cn } from "@luftuj/shared/utils/cn";

import { ICON_STROKE } from "./icon-types";

/** Channel tag colours: a test build (dev, beta) is amber, so it is never mistaken for a release. */
export function channelTone(channel: string) {
  return channel === "stable"
    ? "bg-secondary text-secondary-foreground"
    : "bg-warning-soft text-warning";
}

interface VersionChipProps {
  /** The full APP_VERSION, e.g. "1.1.3-stable" or "2.0.0-dev". */
  version: string;
  /** A newer version, when known (needs a backend endpoint that does not exist yet). */
  update?: string;
  onClick?: () => void;
  className?: string;
}

/** The version as number + channel ("v1.1.3" "stable"). A click opens "Co je nového". */
export function VersionChip({ version, update, onClick, className }: Readonly<VersionChipProps>) {
  const { t } = useTranslation();
  const { version: number, channel } = parseVersion(version);
  // The visible text ("v1.1.3 stable") is the accessible name; a hidden suffix says what the click does.
  const test = channel !== "stable";

  return (
    <button
      type="button"
      data-slot="version-chip"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-card pr-1 pl-2.5 font-mono text-xs leading-4 font-medium text-foreground",
        "transition-[box-shadow,background-color] duration-(--duration-fast)",
        test
          ? "shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--warning)_45%,transparent)]"
          : "shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--input)]",
        "hover:bg-muted",
        className,
      )}
    >
      <span className="tabular-nums">v{number}</span>
      <span
        className={cn(
          "inline-flex h-5 items-center rounded-full px-2 font-mono text-[11px] leading-none tracking-[.04em]",
          channelTone(channel),
        )}
      >
        {channel}
      </span>
      <span className="sr-only">{t("app.version.whatsNew")}</span>
      {update && (
        <span className="inline-flex h-5 items-center gap-1 rounded-full bg-air-soft px-2 font-mono text-[11px] leading-none text-air">
          <IconDownload size={14} stroke={ICON_STROKE} aria-hidden />
          {update}
        </span>
      )}
    </button>
  );
}
