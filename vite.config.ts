import { defineConfig, type Logger } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname);

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
  resolve: {
    alias: {
      "@luftuj/app": path.resolve(rootDir, "src/app"),
      "@luftuj/shared": path.resolve(rootDir, "src/shared"),
      "@luftuj/features": path.resolve(rootDir, "src/features"),
      "@luftuj/config": path.resolve(rootDir, "src/config.ts"),
      "@luftuj/assets": path.resolve(rootDir, "src/assets"),
    },
  },
  customLogger: filteredLogger,
  build: {
    target: "esnext",
    minify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("@mantine")) {
              return "mantine";
            }
            if (id.includes("@tanstack")) {
              return "tanstack";
            }
            if (id.includes("@tabler")) {
              return "icons";
            }
            if (id.includes("date-fns")) {
              return "date-fns";
            }
          }
        },
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const assetName = assetInfo.names[0] ?? assetInfo.originalFileNames[0] ?? "";
          const extType = path.extname(assetName).slice(1);
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType || "")) {
            return `assets/images/[name]-[hash][extname]`;
          }
          if (/woff2?|eot|ttf|otf/i.test(extType || "")) {
            return `assets/fonts/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
      },
    },
    chunkSizeWarningLimit: 500,
    reportCompressedSize: true,
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
