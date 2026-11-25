import { IconPlugConnectedX, IconWind } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import logoMarkDark from "@luftuj/assets/logo-mark-dark.svg";
import logoMarkLight from "@luftuj/assets/logo-mark-light.svg";
import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { indicatorClass, useIndicator } from "@luftuj/shared/ui/use-indicator";
import { cn } from "@luftuj/shared/utils/cn";

import { isActivePath, type NavItem } from "./navigation";
import type { UnitStatus } from "./useUnitStatus";

interface AppHeaderProps {
  items: NavItem[];
  pathname: string;
  /** Leave out on Přehled: UnitPanel right below already shows the unit. */
  unit?: UnitStatus | null;
  /** "dev", "beta"…: an amber tag next to the name, on every page and every screen. Stable shows nothing. */
  channel: string;
}

function formatAge(t: (key: string, options?: Record<string, unknown>) => string, seconds: number) {
  return seconds < 60
    ? t("app.unit.ageSeconds", { count: seconds })
    : t("app.unit.ageMinutes", { count: Math.floor(seconds / 60) });
}

/** The live unit chip: quiet while all is well, amber when the data is old, red when the unit does not answer. */
function UnitChip({ unit }: Readonly<{ unit: UnitStatus }>) {
  const { t } = useTranslation();
  const error = unit.status === "error";
  const age = unit.ageSeconds === null ? null : formatAge(t, unit.ageSeconds);
  const Icon = error ? IconPlugConnectedX : IconWind;

  return (
    <span
      data-status={unit.status}
      title={error ? t("app.unit.notResponding") : age ? t("app.unit.updated", { age }) : undefined}
      className={cn(
        "inline-flex h-10 min-w-0 flex-[0_1_auto] items-center gap-2 rounded-full bg-card pr-3.5 pl-3 whitespace-nowrap shadow-plane",
        error && "bg-destructive-soft shadow-none",
      )}
    >
      <Icon
        size={16}
        stroke={ICON_STROKE}
        aria-hidden
        className={cn(
          "flex-none text-muted-foreground",
          unit.status === "warning" && "text-warning",
          error && "text-destructive",
        )}
      />
      <span className="label min-w-0 truncate">{unit.name}</span>
      {error ? (
        // Compact header: the unplugged icon and the red tint carry it; the word stays for screen readers.
        <span className="code flex-none text-destructive max-md:sr-only">
          {t("app.unit.disconnected")}
        </span>
      ) : (
        age && (
          <span
            className={cn(
              "code text-muted-foreground max-md:hidden",
              unit.status === "warning" && "text-warning",
            )}
          >
            {age}
          </span>
        )
      )}
    </span>
  );
}

/**
 * The top bar: logo, pill navigation with a sliding ink pill, the live unit chip. Sticky and translucent. Below
 * 768px it is compact (no navigation; the TabBar takes over).
 */
export function AppHeader({ items, pathname, unit, channel }: Readonly<AppHeaderProps>) {
  const { t } = useTranslation();
  const nav = useRef<HTMLElement>(null);
  useIndicator(nav, '[aria-current="page"]', pathname);

  return (
    <header
      data-slot="app-header"
      className={cn(
        "sticky top-0 z-30 font-sans text-foreground",
        "bg-background supports-[backdrop-filter]:bg-[color-mix(in_oklab,var(--background)_70%,transparent)]",
        "supports-[backdrop-filter]:backdrop-blur-[14px] supports-[backdrop-filter]:backdrop-saturate-150",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[1328px] items-center gap-6 px-6 max-[1100px]:gap-4 max-md:h-[60px] max-md:justify-between max-md:px-4">
        <Link
          to="/"
          className="inline-flex flex-none items-center gap-2.5 whitespace-nowrap text-foreground no-underline"
        >
          <img
            src={logoMarkLight}
            alt=""
            width={30}
            height={30}
            className="size-[30px] dark:hidden"
          />
          <img
            src={logoMarkDark}
            alt=""
            width={30}
            height={30}
            className="hidden size-[30px] dark:block"
          />
          <span className="font-sans text-[17px] leading-6 font-semibold tracking-[-.02em]">
            LUFTaTOR<span className="sr-only">{t("app.header.homeSuffix")}</span>
          </span>
          {channel !== "stable" && (
            <span
              title={t("app.header.devTag")}
              className="inline-flex h-5 items-center rounded-sm bg-warning-soft px-[7px] font-mono text-[11px] leading-none font-medium tracking-[.04em] text-warning"
            >
              {channel}
            </span>
          )}
        </Link>

        {items.length > 0 && (
          <nav
            ref={nav}
            aria-label={t("app.nav.main")}
            className="relative mx-auto flex gap-1 rounded-full bg-card p-1 shadow-plane supports-[backdrop-filter]:bg-[color-mix(in_oklab,var(--card)_80%,transparent)] max-md:hidden"
          >
            <span aria-hidden="true" className={cn(indicatorClass, "rounded-full bg-primary")} />
            {items.map((item) => {
              const active = isActivePath(pathname, item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "z-1 inline-flex h-10 items-center gap-2 rounded-full px-[18px] font-sans text-sm leading-5 font-medium whitespace-nowrap no-underline max-[1100px]:px-3.5",
                    "transition-colors duration-(--duration-base)",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon size={18} stroke={ICON_STROKE} aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        {unit && <UnitChip unit={unit} />}
      </div>
    </header>
  );
}
