import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1.ts" }] },
  test: { include: ["src/**/*.test.ts", "tests/**/*.test.ts"] },
});
