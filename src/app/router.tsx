import { lazy } from "react";
import { IconError404, IconHome } from "@tabler/icons-react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AppLayout } from "@luftuj/app/layouts/AppLayout";
import { Button } from "@luftuj/shared/ui/button";
import { ErrorState } from "@luftuj/shared/ui/error-state";
import { Spinner } from "@luftuj/shared/ui/spinner";

function RouteErrorComponent({ error, reset }: Readonly<ErrorComponentProps>) {
  const { t } = useTranslation();
  const router = useRouter();
  const message = error instanceof Error ? error.message : String(error);

  function handleRetry() {
    reset();
    void router.invalidate();
  }

  function handleHome() {
    void router.navigate({ to: "/" });
  }

  return (
    <div className="grid min-h-[60vh] place-items-center py-8">
      <ErrorState
        className="w-full max-w-[560px]"
        title={t("errors.route.title")}
        description={t("errors.route.message")}
        details={message}
        onRetry={handleRetry}
        retryLabel={t("errors.route.retry")}
        action={
          <Button variant="ghost" icon={IconHome} onClick={handleHome}>
            {t("errors.route.home")}
          </Button>
        }
      />
    </div>
  );
}

function NotFoundComponent() {
  const { t } = useTranslation();
  const router = useRouter();

  function handleHome() {
    void router.navigate({ to: "/" });
  }

  return (
    <div className="grid min-h-[60vh] place-items-center py-8">
      <ErrorState
        className="w-full max-w-[560px]"
        icon={IconError404}
        title={t("errors.notFound.title")}
        description={t("errors.notFound.message")}
        action={
          <Button variant="secondary" icon={IconHome} onClick={handleHome}>
            {t("errors.notFound.home")}
          </Button>
        }
      />
    </div>
  );
}

function PendingComponent() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner size={32} />
    </div>
  );
}

const DashboardPage = lazy(() =>
  import("../features/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const ValvesPage = lazy(() =>
  import("../features/valves/ValvesPage").then((m) => ({ default: m.ValvesPage })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const TimelinePage = lazy(() =>
  import("../features/timeline/TimelinePage").then((m) => ({ default: m.TimelinePage })),
);
const DebugPage = lazy(() =>
  import("../features/debug/DebugPage").then((m) => ({ default: m.DebugPage })),
);
const HaEntitiesPage = lazy(() =>
  import("../features/debug/ha-entities/HaEntitiesPage").then((m) => ({
    default: m.HaEntitiesPage,
  })),
);
const OnboardingPage = lazy(() =>
  import("../features/onboarding/OnboardingPage").then((m) => ({ default: m.OnboardingPage })),
);

const rootRoute = createRootRoute({
  component: AppLayout,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});

const valvesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/valves",
  component: ValvesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
  /**
   * Which accordion section to open on arrival, so another page can link
   * straight at the setting it is talking about instead of leaving the user to
   * hunt for it.
   */
  validateSearch: (search: Record<string, unknown>): { section?: string } => {
    const raw = search.section;
    return typeof raw === "string" && raw.trim() !== "" ? { section: raw } : {};
  },
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/timeline",
  component: TimelinePage,
  /**
   * Which season - or which custom timeline - is being *viewed*. Deliberately
   * separate from what is running: browsing another plan must never change what
   * the unit is doing. Keeping it in the URL means the selection survives a
   * reload and the back button, and can be linked to. A custom timeline wins
   * when both are given; the two are never viewed at once.
   */
  validateSearch: (search: Record<string, unknown>): { season?: number; custom?: number } => {
    function positive(raw: unknown): number | undefined {
      const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }
    const custom = positive(search.custom);
    if (custom !== undefined) return { custom };
    const season = positive(search.season);
    return season === undefined ? {} : { season };
  },
});

const debugRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/debug",
  component: DebugPage,
});

const haEntitiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/debug/home-assistant",
  component: HaEntitiesPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: OnboardingPage,
});

// Dev-only showcase of the design-system primitives (#/ui). `import.meta.env.DEV` is a build-time constant, so the
// route and its lazy chunk do not exist in a production build.
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/ui",
        component: lazy(() => import("@luftuj/app/dev/UiShowcasePage")),
      }),
    ]
  : [];

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  valvesRoute,
  settingsRoute,
  timelineRoute,
  debugRoute,
  haEntitiesRoute,
  onboardingRoute,
  ...devRoutes,
]);

const hashHistory = createHashHistory();

const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPendingComponent: PendingComponent,
  defaultErrorComponent: RouteErrorComponent,
  defaultNotFoundComponent: NotFoundComponent,
});

declare module "@tanstack/react-router" {
  // noinspection JSUnusedGlobalSymbols
  interface Register {
    router: typeof router;
  }
}

export { router };
