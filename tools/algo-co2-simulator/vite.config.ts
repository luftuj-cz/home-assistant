import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: {
    // The repo root covers both its node_modules and the algo-co2 package outside this folder.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
