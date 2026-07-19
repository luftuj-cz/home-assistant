import { lazy } from "react";
import { Button, Group } from "@mantine/core";
import { IconError404, IconHome, IconRefresh } from "@tabler/icons-react";
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
import { ErrorState, LoadingState } from "@luftuj/shared/ui";

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
    <ErrorState
      minHeight="100vh"
      title={t("errors.route.title")}
      description={t("errors.route.message")}
      detail={message}
      detailLabel={t("errors.route.details")}
      action={
        <Group gap="sm">
          <Button leftSection={<IconRefresh size={16} />} onClick={handleRetry}>
            {t("errors.route.retry")}
          </Button>
          <Button variant="light" leftSection={<IconHome size={16} />} onClick={handleHome}>
            {t("errors.route.home")}
          </Button>
        </Group>
      }
    />
  );
}

function NotFoundComponent() {
  const { t } = useTranslation();
  const router = useRouter();

  function handleHome() {
    void router.navigate({ to: "/" });
  }

  return (
    <ErrorState
      minHeight="100vh"
      icon={<IconError404 size={32} />}
      title={t("errors.notFound.title")}
      description={t("errors.notFound.message")}
      action={
        <Button variant="light" leftSection={<IconHome size={16} />} onClick={handleHome}>
          {t("errors.notFound.home")}
        </Button>
      }
    />
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
});

const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/timeline",
  component: TimelinePage,
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

const routeTree = rootRoute.addChildren([
  dashboardRoute,
  valvesRoute,
  settingsRoute,
  timelineRoute,
  debugRoute,
  haEntitiesRoute,
  onboardingRoute,
]);

const hashHistory = createHashHistory();

const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPendingComponent: () => <LoadingState label="Loading…" minHeight="100vh" />,
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
