import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);

// Parse arguments: --dev or --stable flag, then version
let releaseType = "stable"; // default
let newVersion = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dev") {
    releaseType = "dev";
  } else if (args[i] === "--stable") {
    releaseType = "stable";
  } else if (!args[i].startsWith("--")) {
    newVersion = args[i];
  }
}

if (!newVersion) {
  console.error("Usage: node scripts/set-version.mjs [--dev|--stable] <version>");
  console.error("  --dev     Set development version (appends -dev suffix)");
  console.error("  --stable  Set stable version (appends -stable suffix, default)");
  console.error("");
  console.error("Examples:");
  console.error("  node scripts/set-version.mjs --stable 1.0.4  ->  1.0.4-stable");
  console.error("  node scripts/set-version.mjs --dev 1.0.4      ->  1.0.4-dev");
  process.exit(1);
}

// Append release type suffix if not already present
const fullVersion = newVersion.endsWith(`-${releaseType}`)
  ? newVersion
  : `${newVersion}-${releaseType}`;

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

console.log(`Setting version to: ${fullVersion} (${releaseType} release)`);

// 1. Update package.json
const pkg = JSON.parse(readFileSync(ROOT_PKG_PATH, "utf-8"));
pkg.version = fullVersion;
writeFileSync(ROOT_PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Updated ${ROOT_PKG_PATH}`);

// 2. Update constants.ts
let constantsContent = readFileSync(CONSTANTS_PATH, "utf-8");
const constantsRegex = /export const APP_VERSION = ".*";/;
if (constantsRegex.test(constantsContent)) {
  constantsContent = constantsContent.replace(
    constantsRegex,
    `export const APP_VERSION = "${fullVersion}";`,
  );
} else {
  // Fallback if not found (unexpected)
  constantsContent = `export const APP_VERSION = "${fullVersion}";\n${constantsContent}`;
  console.warn(`Warning: APP_VERSION not found in constants.ts, prepended it.`);
}
writeFileSync(CONSTANTS_PATH, constantsContent);
console.log(`Updated ${CONSTANTS_PATH}`);

// 3. Update addon/config.yaml
let configContent = readFileSync(ADDON_CONFIG_PATH, "utf-8");
const configRegex = /^version: .*$/m;
if (configRegex.test(configContent)) {
  configContent = configContent.replace(configRegex, `version: ${fullVersion}`);
} else {
  // Fallback
  configContent = `version: ${fullVersion}\n${configContent}`;
}

// Update name, slug, description, and image based on release type
if (releaseType === "dev") {
  configContent = configContent.replace(/^name: .*$/m, `name: LUFTaTOR (Development)`);
  configContent = configContent.replace(/^slug: .*$/m, `slug: luftator-dev`);
  configContent = configContent.replace(
    /^description: .*$/m,
    `description: LUFTaTOR Home Assistant Add-on (Development Version)`,
  );
  configContent = configContent.replace(
    /image: "ghcr\.io\/luftuj-cz\/{arch}-addon-luftuj"$/m,
    `image: "ghcr.io/luftuj-cz/{arch}-addon-luftuj-dev"`,
  );
} else {
  configContent = configContent.replace(/^name: .*$/m, `name: LUFTaTOR`);
  configContent = configContent.replace(/^slug: .*$/m, `slug: luftator`);
  configContent = configContent.replace(
    /^description: .*$/m,
    `description: LUFTaTOR Home Assistant Add-on`,
  );
  configContent = configContent.replace(
    /image: "ghcr\.io\/luftuj-cz\/{arch}-addon-luftuj-dev"$/m,
    `image: "ghcr.io/luftuj-cz/{arch}-addon-luftuj"`,
  );
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
    `export const APP_VERSION = "${fullVersion}";`,
  );
} else {
  // Fallback
  frontendConfigContent = `export const APP_VERSION = "${fullVersion}";\n${frontendConfigContent}`;
  console.warn(`Warning: APP_VERSION not found in src/config.ts, prepended it.`);
}
writeFileSync(FRONTEND_CONFIG_PATH, frontendConfigContent);
console.log(`Updated ${FRONTEND_CONFIG_PATH}`);

console.log(`\nVersion successfully updated to ${fullVersion}`);
