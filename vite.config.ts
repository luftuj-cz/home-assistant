import { defineConfig, type Logger } from "vite";
import react from "@vitejs/plugin-react";

type ProxyServer = {
  removeAllListeners(event: string): void;
  on(event: "error", listener: (err: Error & { code?: string }) => void): void;
};

const filteredLogger: Logger = {
  hasErrorLogged() {
    return false;
  },
  hasWarned: false,
  info(msg: string) {
    console.info(msg);
  },
  warn(msg: string) {
    console.warn(msg);
  },
  warnOnce(msg: string) {
    console.warn(msg);
  },
  error(msg: string) {
    // Filter out noisy WS proxy errors from Vite dev server
    if (
      msg.includes("ws proxy error") ||
      msg.includes("ws proxy socket error") ||
      msg.includes("ECONNABORTED") ||
      msg.includes("ECONNRESET")
    ) {
      return;
    }

    console.error(msg);
  },
  clearScreen() {
    // Do not clear user's terminal
  },
};

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  customLogger: filteredLogger,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@mantine")) {
              return "mantine";
            }
            if (id.includes("@tabler/icons-react")) {
              return "icons";
            }
            if (id.includes("framer-motion")) {
              return "framer-motion";
            }
            if (id.includes("react-big-calendar")) {
              return "calendar";
            }
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("@tanstack") ||
              id.includes("i18next")
            ) {
              return "react-tanstack";
            }
            return "vendor";
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        changeOrigin: true,
        ws: true,
        configure: (proxy: ProxyServer) => {
          // Remove Vite's default error listeners so we can control logging ourselves
          proxy.removeAllListeners("error");

          proxy.on("error", (err: Error & { code?: string }) => {
            const code = err?.code;

            // Ignore expected aborted/closed socket errors during development
            if (code === "ECONNABORTED" || code === "ECONNRESET" || code === "EPIPE") {
              return;
            }

            // Log other errors so they are still visible
            console.error("[vite ws proxy error]", err);
          });
        },
      },
    },
  },
});
