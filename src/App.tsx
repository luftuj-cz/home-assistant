import {
  MantineProvider,
  createTheme,
  localStorageColorSchemeManager,
  useMantineColorScheme,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useEffect, useMemo } from "react";

import { router } from "./router";
import i18n, { getInitialLanguage, isSupportedLanguage, setLanguage } from "./i18n";
import { createLogger, setLogLevel, type LogLevel } from "./utils/logger";
import { resolveApiUrl } from "./utils/api";

const logger = createLogger("App");

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  cursorType: "pointer",
  colors: {
    blue: [
      "#e7f5ff",
      "#d0ebff",
      "#a5d8ff",
      "#74c0fc",
      "#4dabf7",
      "#339af0",
      "#228be6",
      "#1c7ed6",
      "#1971c2",
      "#1864ab",
    ],
  },
  components: {
    Notification: {
      styles: {
        root: {
          backdropFilter: "blur(20px)",
          padding: "var(--mantine-spacing-md)",
          borderRadius: "var(--mantine-radius-xl)",
          overflow: "hidden",
          border: "1.5px solid rgba(255, 255, 255, 0.5)",
          backgroundColor: "rgba(var(--mantine-color-body-rgb), 0.95)",
          boxShadow: "0 15px 45px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(255, 255, 255, 0.05), inset 0 0 0 1px rgba(255, 255, 255, 0.2)",
        },
        icon: {
          width: 40,
          height: 40,
          borderRadius: "var(--mantine-radius-lg)",
          fontSize: 22,
          backgroundColor: "var(--mantine-color-gray-light)",
        },
        title: {
          fontWeight: 800,
          fontSize: "var(--mantine-font-size-md)",
          marginBottom: 6,
          letterSpacing: "-0.01em",
        },
        description: {
          color: "var(--mantine-color-text)",
          opacity: 0.9,
          fontSize: "var(--mantine-font-size-sm)",
          lineHeight: 1.5,
          fontWeight: 500,
        },
        closeButton: {
          borderRadius: "var(--mantine-radius-md)",
        },
      },
    },
  },
});

const colorSchemeManager = localStorageColorSchemeManager({ key: "luftujha-color-scheme" });

function ThemeInitializer() {
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    let active = true;

    // Only synchronise once per session to avoid loops when theme changes
    if (sessionStorage.getItem("luftujha-theme-synced")) {
      return;
    }

    async function synchroniseTheme() {
      try {
        const response = await fetch(resolveApiUrl("/api/settings/theme"));
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { theme?: string };
        if (!active) {
          return;
        }
        if (data.theme === "dark" || data.theme === "light") {
          setColorScheme(data.theme);
          sessionStorage.setItem("luftujha-theme-synced", "true");
        }
      } catch (error) {
        logger.error("Failed to load persisted theme", { error });
      }
    }

    void synchroniseTheme();

    return () => {
      active = false;
    };
  }, [setColorScheme]);

  return null;
}

function LogLevelInitializer() {
  useEffect(() => {
    let active = true;

    async function initialiseLogLevel() {
      try {
        const response = await fetch(resolveApiUrl("/api/settings/log-level"));
        if (!response?.ok) {
          return;
        }
        const data = (await response.json()) as { level?: string };
        if (!active) {
          return;
        }
        if (data.level) {
          setLogLevel(data.level as LogLevel);
          logger.info("Log level initialised from backend", { level: data.level });
        }
      } catch (error) {
        logger.error("Failed to initialise log level from backend", { error });
      }
    }

    void initialiseLogLevel();

    return () => {
      active = false;
    };
  }, []);

  return null;
}

function LanguageInitializer() {
  useEffect(() => {
    let active = true;

    async function initialiseLanguage() {
      try {
        await setLanguage(getInitialLanguage());

        const response = await fetch(resolveApiUrl("/api/settings/language"));
        if (!response?.ok) {
          return;
        }
        const data = (await response.json()) as { language?: string };
        if (!active) {
          return;
        }
        if (data.language && isSupportedLanguage(data.language)) {
          await setLanguage(data.language);
        }
      } catch (error) {
        logger.error("Failed to synchronise language preference", { error });
      }
    }

    void initialiseLanguage();

    return () => {
      active = false;
    };
  }, []);

  return null;
}

export default function App() {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n} defaultNS="common">
        <MantineProvider
          theme={theme}
          colorSchemeManager={colorSchemeManager}
          defaultColorScheme="dark"
        >
          <LanguageInitializer />
          <LogLevelInitializer />
          <ThemeInitializer />
          <Notifications position="bottom-left" limit={3} zIndex={4000} containerWidth={440} />
          <RouterProvider router={router} />
        </MantineProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
