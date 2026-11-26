import {
  IconAdjustmentsHorizontal,
  IconBug,
  IconLayoutDashboard,
  IconSparkles,
  IconTimelineEvent,
} from "@tabler/icons-react";

import type { IconComponent } from "@luftuj/shared/ui/icon-types";
import { IconDamper } from "@luftuj/shared/ui/icons";

export interface NavItem {
  to: "/" | "/valves" | "/automatic" | "/timeline" | "/settings" | "/debug";
  label: string;
  icon: IconComponent;
}

/** The main sections, one icon per concept (design system: Iconography). Ladění only in debug mode. */
export function navigationItems(t: (key: string) => string, debug: boolean): NavItem[] {
  const items: NavItem[] = [
    { to: "/", label: t("app.nav.dashboard"), icon: IconLayoutDashboard },
    { to: "/valves", label: t("app.nav.valves"), icon: IconDamper },
    { to: "/automatic", label: t("app.nav.automatic"), icon: IconSparkles },
    { to: "/timeline", label: t("app.nav.timeline"), icon: IconTimelineEvent },
    { to: "/settings", label: t("app.nav.settings"), icon: IconAdjustmentsHorizontal },
  ];
  if (debug) {
    items.push({ to: "/debug", label: t("app.nav.debug"), icon: IconBug });
  }
  return items;
}

/** Přehled only on "/"; the others also for their sub-pages (Ladění → Entity HA). */
export function isActivePath(pathname: string, to: NavItem["to"]) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}
