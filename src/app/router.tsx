import { lazy } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
} from "@tanstack/react-router";

import { AppLayout } from "@luftuj/app/layouts/AppLayout";
import { LoadingState } from "@luftuj/shared/ui";

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
  onboardingRoute,
]);

const hashHistory = createHashHistory();

const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPendingComponent: () => <LoadingState label="Loading…" minHeight="100vh" />,
});

declare module "@tanstack/react-router" {
  // noinspection JSUnusedGlobalSymbols
  interface Register {
    router: typeof router;
  }
}

export { router };
