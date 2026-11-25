import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { ICON_STROKE } from "@luftuj/shared/ui/icon-types";
import { indicatorClass, useIndicator } from "@luftuj/shared/ui/use-indicator";
import { cn } from "@luftuj/shared/utils/cn";

import { isActivePath, type NavItem } from "./navigation";

interface TabBarProps {
  items: NavItem[];
  pathname: string;
}

/**
 * Floating bottom navigation on phones: icon + label, never icon-only. The air-soft pill slides behind the active
 * icon; the icon dips when pressed. Every pixel of the bar is a target (at least 64px tall), and the bar sits above
 * the home indicator. Pages reserve 96px at the bottom so content clears it.
 */
export function TabBar({ items, pathname }: Readonly<TabBarProps>) {
  const { t } = useTranslation();
  const nav = useRef<HTMLElement>(null);
  useIndicator(nav, '[aria-current="page"] [data-tab-icon]', pathname);
  const five = items.length >= 5;

  return (
    <nav
      ref={nav}
      data-slot="tab-bar"
      aria-label={t("app.nav.main")}
      className={cn(
        "fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex rounded-xl font-sans md:hidden",
        "bg-popover shadow-[var(--shadow-float),inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]",
        "supports-[backdrop-filter]:bg-[color-mix(in_oklab,var(--popover)_76%,transparent)] supports-[backdrop-filter]:backdrop-blur-[18px] supports-[backdrop-filter]:backdrop-saturate-[1.6]",
      )}
    >
      <span aria-hidden="true" className={cn(indicatorClass, "rounded-full bg-air-soft")} />
      {items.map((item) => {
        const active = isActivePath(pathname, item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              // Not position:relative: the indicator measures the icon's offset from the bar.
              "group/tab z-1 grid min-h-16 min-w-0 flex-1 content-center justify-items-center gap-0.5 px-0.5 py-1.5",
              "text-[11px] leading-[14px] font-medium whitespace-nowrap no-underline [-webkit-tap-highlight-color:transparent]",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              five && "px-0 tracking-[-.01em] max-[380px]:text-[10.5px] max-[340px]:text-[10px]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span
              data-tab-icon=""
              className={cn(
                "grid h-[30px] w-[52px] place-items-center",
                five && "max-[340px]:w-11",
                active && "text-air",
              )}
            >
              <Icon
                size={22}
                stroke={ICON_STROKE}
                aria-hidden
                className={cn(
                  "transition-[scale] duration-(--duration-base) ease-(--ease-spring) group-active/tab:scale-[.86]",
                  active && "scale-[1.06]",
                )}
              />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
