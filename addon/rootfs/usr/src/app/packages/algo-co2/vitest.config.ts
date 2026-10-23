import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "algo-co2",
    include: ["tests/**/*.test.ts"],
  },
});
