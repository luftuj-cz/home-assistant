import { defineConfig } from "vitest/config";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname);

export default defineConfig({
  resolve: {
    alias: {
      "@luftuj/app": path.resolve(rootDir, "src/app"),
      "@luftuj/shared": path.resolve(rootDir, "src/shared"),
      "@luftuj/features": path.resolve(rootDir, "src/features"),
      "@luftuj/config": path.resolve(rootDir, "src/config.ts"),
      "@luftuj/assets": path.resolve(rootDir, "src/assets"),
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:3000/",
      },
    },
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
