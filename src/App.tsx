import {
  MantineProvider,
  createTheme,
  localStorageColorSchemeManager,
  useMantineColorScheme,
  type MantineTheme,
  type NotificationProps,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { RouterProvider } from "@tanstack/react-router";
import { I18nextProvider } from "react-i18next";
import { Suspense, useEffect } from "react";

import { router } from "./router";
import i18n, { getInitialLanguage, isSupportedLanguage, setLanguage } from "./i18n";
import { logger } from "./utils/logger";

const theme = createTheme({
  primaryColor: "blue",
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
      styles: (_theme: MantineTheme, props: NotificationProps) => {
        const color = props.color || "gray";
        return {
          root: {
            backdropFilter: "blur(20px)",
            backgroundColor: props.color
              ? `rgba(var(--mantine-color-${color}-light-color), 0.45)`
              : "rgba(var(--mantine-color-body-rgb), 0.95)",
            border: `1.5px solid ${
              props.color ? `var(--mantine-color-${color}-filled)` : "rgba(255, 255, 255, 0.5)"
            }`,
            boxShadow: props.color
              ? `0 15px 45px rgba(var(--mantine-color-${color}-light-color), 0.35), 0 0 0 2px rgba(var(--mantine-color-${color}-light-color), 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.2)`
              : "0 15px 45px rgba(0, 0, 0, 0.3), 0 0 0 2px rgba(255, 255, 255, 0.05), inset 0 0 0 1px rgba(255, 255, 255, 0.2)",
            padding: "var(--mantine-spacing-md)",
            borderRadius: "var(--mantine-radius-xl)",
            overflow: "hidden",
          },
          icon: {
            width: 40,
            height: 40,
            borderRadius: "var(--mantine-radius-lg)",
            fontSize: 22,
            backgroundColor: props.color
              ? `var(--mantine-color-${color}-light)`
              : "var(--mantine-color-gray-light)",
          },
          inner: {
            paddingLeft: "var(--mantine-spacing-md)",
          },
          title: {
            fontWeight: 800,
            fontSize: "var(--mantine-font-size-md)",
            marginBottom: 6,
            letterSpacing: "-0.01em",
            color: props.color ? `var(--mantine-color-${color}-filled)` : "inherit",
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
            "&:hover": {
              backgroundColor: "rgba(0, 0, 0, 0.05)",
            },
          },
        };
      },
    },
  },
});

const colorSchemeManager = localStorageColorSchemeManager({ key: "luftujha-color-scheme" });

function ThemeInitializer() {
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    let active = true;

    async function synchroniseTheme() {
      try {
        const response = await fetch("/api/settings/theme");
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as { theme?: string };
        if (!active) {
          return;
        }
        if (data.theme === "dark" || data.theme === "light") {
          setColorScheme(data.theme);
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

function LanguageInitializer() {
  useEffect(() => {
    let active = true;

    async function initialiseLanguage() {
      try {
        await setLanguage(getInitialLanguage());

        const response = await fetch("/api/settings/language");
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
  return (
    <I18nextProvider i18n={i18n} defaultNS="common">
      <MantineProvider
        theme={theme}
        withCssVariables
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="dark"
      >
        <LanguageInitializer />
        <ThemeInitializer />
        <Notifications position="bottom-left" limit={3} zIndex={4000} containerWidth={440} />
        <Suspense fallback={null}>
          <RouterProvider router={router} />
        </Suspense>
      </MantineProvider>
    </I18nextProvider>
  );
}
