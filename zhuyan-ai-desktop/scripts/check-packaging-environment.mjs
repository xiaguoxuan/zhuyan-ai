import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error(`Node.js ${process.versions.node} is too old; Zhuyan packaging requires Node.js >= 22.19.0`);
}
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
if (packageJson.version !== "0.10.4") throw new Error(`Unexpected Desktop version: ${packageJson.version}`);
for (const relative of [
  "electron/main.ts",
  "electron/pi-runtime.ts",
  "scripts/prepare-packaging-runtime.mjs",
  "scripts/verify-built-renderer.mjs",
  "scripts/packaging-audit-lib.mjs",
  "scripts/audit-installer.mjs",
  "scripts/audit-mac-dmg.mjs",
  "scripts/create-reference-hash-manifest.mjs",
  "scripts/prepare-mac-arm64-build-kit.mjs",
  "../pi-soft-furnish-agent/extensions/soft-furnish.ts",
  "../pi-soft-furnish-agent/data/style-recipes.json",
]) {
  await access(path.resolve(projectRoot, relative));
}
console.log(`NODE_VERSION_OK: ${process.versions.node}`);
console.log("ZHUYAN_PACKAGING_ENVIRONMENT_OK");
