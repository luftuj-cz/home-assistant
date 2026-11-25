import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { APP_VERSION } from "@luftuj/config";
import { Spinner } from "@luftuj/shared/ui/spinner";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { parseVersion } from "@luftuj/shared/utils/changelog";

import { AppFooter } from "./AppFooter";
import { AppHeader } from "./AppHeader";
import { navigationItems } from "./navigation";
import { TabBar } from "./TabBar";
import { useUnitStatus } from "./useUnitStatus";

const CHANNEL = parseVersion(APP_VERSION).channel;

/**
 * The app shell: AppHeader (desktop pill nav, compact on phones), the page, the Footer (desktop) and the TabBar
 * (phones). The ground is `background` with a soft air-soft glow from the top edge, the system's only gradient.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const { data: onboardingStatus, isLoading: isLoadingStatus } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/onboarding-status"));
      if (!res.ok) return null; // Fail silently
      return (await res.json()) as { onboardingDone: boolean };
    },
    // Don't refetch too often, just initial load is critical
    refetchOnWindowFocus: false,
  });

  const { data: debugMode } = useQuery({
    queryKey: ["debug-mode-check"],
    queryFn: async () => {
      const res = await fetch(resolveApiUrl("/api/settings/debug-mode"));
      if (!res.ok) return { enabled: false };
      return (await res.json()) as { enabled: boolean };
    },
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isLoadingStatus) return;
    if (!onboardingStatus) return;

    const isDoingOnboarding = location.pathname === "/onboarding";

    if (!onboardingStatus.onboardingDone && !isDoingOnboarding) {
      void navigate({ to: "/onboarding" });
    } else if (onboardingStatus.onboardingDone && isDoingOnboarding) {
      void navigate({ to: "/" });
    }
  }, [onboardingStatus, isLoadingStatus, location.pathname, navigate]);

  const isOnboarding = location.pathname === "/onboarding";
  const showNav = onboardingStatus?.onboardingDone !== false && !isOnboarding;

  const navItems = useMemo(
    () => (showNav ? navigationItems(t, debugMode?.enabled === true) : []),
    [t, showNav, debugMode?.enabled],
  );

  // The unit chip is for the pages where the unit is otherwise out of sight; Přehled shows it in UnitPanel.
  const unit = useUnitStatus(showNav && location.pathname !== "/");

  function content() {
    if (isLoadingStatus && !isOnboarding) {
      return (
        <div className="grid h-[60vh] place-items-center">
          <Spinner size={32} />
        </div>
      );
    }
    if (onboardingStatus?.onboardingDone === false && !isOnboarding) {
      return (
        <div className="grid h-[60vh] place-items-center">
          <Spinner size={28} label={t("onboarding.status.waitingTitle")} />
        </div>
      );
    }
    return <Outlet />;
  }

  return (
    <div
      data-slot="app"
      className="flex min-h-dvh flex-col bg-background bg-[radial-gradient(90%_420px_at_50%_-140px,var(--air-soft),transparent_72%)] bg-no-repeat"
    >
      {/* Onboarding draws its own brand line above the wizard card, as in the design. */}
      {!isOnboarding && (
        <AppHeader items={navItems} pathname={location.pathname} unit={unit} channel={CHANNEL} />
      )}
      <main
        className={
          navItems.length > 0
            ? "mx-auto w-full max-w-[1328px] flex-1 px-6 pt-2 pb-8 max-md:px-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom))]"
            : "mx-auto w-full max-w-[1328px] flex-1 px-6 pt-2 pb-8 max-md:px-4"
        }
      >
        {content()}
      </main>
      {!isOnboarding && <AppFooter />}
      {navItems.length > 0 && <TabBar items={navItems} pathname={location.pathname} />}
    </div>
  );
}
