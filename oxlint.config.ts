import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: [
    "dist/",
    "addon/rootfs/usr/share/luftujha/www/",
    "node_modules/",
    ".git/",
    ".vite-temp/",
  ],
  rules: {
    // Style rules (quotes, semicolons) are handled by Oxfmt, not Oxlint
    // Code quality rules:
    "func-style": ["error", "declaration", { allowArrowFunctions: false }],
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",
    "react/only-export-components": "warn",
  },
  overrides: [
    {
      files: ["addon/rootfs/usr/src/app/src/**/*.ts"],
      rules: {
        "func-style": ["error", "declaration", { allowArrowFunctions: false }],
      },
    },
  ],
});
