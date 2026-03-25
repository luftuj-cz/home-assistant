import {
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  lazyRouteComponent,
} from "@tanstack/react-router";

import { AppLayout } from "./layouts/AppLayout";

const DashboardPage = lazyRouteComponent(() => import("./pages/DashboardPage"));
const ValvesPage = lazyRouteComponent(() => import("./pages/ValvesPage"));
const SettingsPage = lazyRouteComponent(() => import("./pages/SettingsPage"));
const TimelinePage = lazyRouteComponent(() => import("./pages/TimelinePage"));
const DebugPage = lazyRouteComponent(() => import("./pages/DebugPage"));
const OnboardingPage = lazyRouteComponent(() => import("./pages/OnboardingPage"));

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

const router = createRouter({ routeTree, history: hashHistory });

declare module "@tanstack/react-router" {
  // noinspection JSUnusedGlobalSymbols
  interface Register {
    router: typeof router;
  }
}

export { router };
