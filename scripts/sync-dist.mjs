import { access, cp, mkdir, rm } from "fs/promises";
import { constants } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const distDir = path.join(projectRoot, "dist");
const targetDir = path.join(projectRoot, "addon", "rootfs", "usr", "share", "luftujha", "www");

async function ensureDistExists() {
  try {
    await access(distDir, constants.F_OK);
  } catch (error) {
    console.error('dist/ not found. Run "npm run build" first.', error);
    process.exit(1);
  }
}

async function syncDist() {
  await ensureDistExists();

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(distDir, targetDir, { recursive: true });

  console.log(`Synced ${distDir} -> ${targetDir}`);
}

syncDist().catch((error) => {
  console.error("Failed to sync dist:", error);
  process.exit(1);
});
