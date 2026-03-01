import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const srcLocalesDir = path.join(rootDir, "src", "i18n", "locales");
const destLocalesDir = path.join(rootDir, "addon", "rootfs", "usr", "src", "app", "src", "locales");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDirectory(srcDir, destDir) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  try {
    await ensureDir(destLocalesDir);
    await copyDirectory(srcLocalesDir, destLocalesDir);
    console.log(`Copied translations from ${srcLocalesDir} to ${destLocalesDir}`);
  } catch (err) {
    console.error("Failed to copy translations:", err);
    process.exitCode = 1;
  }
}

void main();
