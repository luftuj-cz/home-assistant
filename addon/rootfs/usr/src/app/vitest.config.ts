import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1.ts" }] },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Keeps a test that imports the database module before setting
    // LUFTATOR_DB_PATH away from the real data directory.
    setupFiles: ["./tests/helpers/setupEnv.ts"],
  },
});
