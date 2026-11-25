import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useEffect } from "react";

import { router } from "@luftuj/app/router";
import i18n, { getInitialLanguage, isSupportedLanguage, setLanguage } from "@luftuj/shared/i18n";
import { createLogger, setLogLevel, type LogLevel } from "@luftuj/shared/utils/logger";
import { resolveApiUrl } from "@luftuj/shared/utils/api";
import { TemperatureUnitProvider } from "@luftuj/shared/temperature/TemperatureUnitProvider";
import { ThemeProvider } from "@luftuj/shared/theme/ThemeProvider";
import { Toaster } from "@luftuj/shared/ui/sonner";
import { TooltipProvider } from "@luftuj/shared/ui/tooltip";

const logger = createLogger("App");

const queryClient = new QueryClient();

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
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n} defaultNS="common">
        <ThemeProvider>
          <TemperatureUnitProvider>
            <TooltipProvider>
              <LanguageInitializer />
              <LogLevelInitializer />
              <Toaster />
              <RouterProvider router={router} />
            </TooltipProvider>
          </TemperatureUnitProvider>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
