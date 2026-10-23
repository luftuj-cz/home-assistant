// Vite+ 1.x keeps oxlint nested inside vite-plus, so only its types are reachable from here.
import type { OxlintConfig } from "vite-plus/lint";

// noinspection JSUnusedGlobalSymbols
export default {
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
    // LUFTaTOR Algo CO2 stays standalone: no dependencies and no reaching into the
    // backend around it, so the backend can import the package but never the reverse.
    {
      files: ["addon/rootfs/usr/src/app/packages/algo-co2/src/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                regex: "^[^.]",
                message: "LUFTaTOR Algo CO2 has no dependencies; inject what it needs instead.",
              },
              {
                regex: "^\\.\\./\\.\\./",
                message: "LUFTaTOR Algo CO2 must not import code outside its package.",
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        "addon/rootfs/usr/src/app/packages/algo-co2/tests/**/*.ts",
        "addon/rootfs/usr/src/app/packages/algo-co2/vitest.config.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                // gitignore semantics, last match wins; a matching negation here also
                // skips any further pattern, hence ../../** inside the same group.
                group: ["*", "!vitest", "!vitest/**", "!./**", "!../**", "../../**"],
                message: "LUFTaTOR Algo CO2 tests may import only Vitest and the package itself.",
              },
            ],
          },
        ],
      },
    },
  ],
} satisfies OxlintConfig;
