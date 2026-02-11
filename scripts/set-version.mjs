import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const newVersion = args[0];

if (!newVersion) {
  console.error("Usage: bun scripts/set-version.mjs <new-version>");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

const ROOT_PKG_PATH = join(ROOT_DIR, "package.json");
const CONSTANTS_PATH = join(
  ROOT_DIR,
  "addon",
  "rootfs",
  "usr",
  "src",
  "app",
  "src",
  "constants.ts",
);
const ADDON_CONFIG_PATH = join(ROOT_DIR, "addon", "config.yaml");

console.log(`Setting version to: ${newVersion}`);

// 1. Update package.json
const pkg = JSON.parse(readFileSync(ROOT_PKG_PATH, "utf-8"));
pkg.version = newVersion;
writeFileSync(ROOT_PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Updated ${ROOT_PKG_PATH}`);

// 2. Update constants.ts
let constantsContent = readFileSync(CONSTANTS_PATH, "utf-8");
const constantsRegex = /export const APP_VERSION = ".*";/;
if (constantsRegex.test(constantsContent)) {
  constantsContent = constantsContent.replace(
    constantsRegex,
    `export const APP_VERSION = "${newVersion}";`,
  );
} else {
  // Fallback if not found (unexpected)
  constantsContent = `export const APP_VERSION = "${newVersion}";\n${constantsContent}`;
  console.warn(`Warning: APP_VERSION not found in constants.ts, prepended it.`);
}
writeFileSync(CONSTANTS_PATH, constantsContent);
console.log(`Updated ${CONSTANTS_PATH}`);

// 3. Update addon/config.yaml
let configContent = readFileSync(ADDON_CONFIG_PATH, "utf-8");
const configRegex = /^version: .*$/m;
if (configRegex.test(configContent)) {
  configContent = configContent.replace(configRegex, `version: ${newVersion}`);
} else {
  // Fallback
  configContent = `version: ${newVersion}\n${configContent}`;
}
writeFileSync(ADDON_CONFIG_PATH, configContent);
console.log(`Updated ${ADDON_CONFIG_PATH}`);

// 4. Update src/config.ts
const FRONTEND_CONFIG_PATH = join(ROOT_DIR, "src", "config.ts");
let frontendConfigContent = readFileSync(FRONTEND_CONFIG_PATH, "utf-8");
const frontendConfigRegex = /export const APP_VERSION = ".*";/;
if (frontendConfigRegex.test(frontendConfigContent)) {
  frontendConfigContent = frontendConfigContent.replace(
    frontendConfigRegex,
    `export const APP_VERSION = "${newVersion}";`,
  );
} else {
  // Fallback
  frontendConfigContent = `export const APP_VERSION = "${newVersion}";\n${frontendConfigContent}`;
  console.warn(`Warning: APP_VERSION not found in src/config.ts, prepended it.`);
}
writeFileSync(FRONTEND_CONFIG_PATH, frontendConfigContent);
console.log(`Updated ${FRONTEND_CONFIG_PATH}`);

console.log(`\nVersion successfully updated to ${newVersion}`);
