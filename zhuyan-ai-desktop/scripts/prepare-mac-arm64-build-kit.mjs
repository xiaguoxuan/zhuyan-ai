import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const piagentRoot = path.resolve(desktopRoot, "..");
const outputRoot = path.resolve(process.argv[2] || path.join(piagentRoot, "mac-arm64-build-kit"));
const desktopOutput = path.join(outputRoot, "zhuyan-ai-desktop");
const manifestSource = path.join(desktopRoot, "private-audit-input", "reference-library-sha256.json");
const expectedDesktopVersion = "0.10.4";
const expectedRuntimeVersion = "0.8.2";

const desktopFiles = [
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.electron.json",
  "vite.config.ts",
  "electron/main.ts",
  "electron/pi-runtime.ts",
  "electron/preload.cts",
  "electron/preload.ts",
  "electron/provider-settings.ts",
  "shared/contracts.ts",
  "src/App.tsx",
  "src/main.tsx",
  "src/styles.css",
  "src/vite-env.d.ts",
  "scripts/after-pack-audit.cjs",
  "scripts/audit-installer.mjs",
  "scripts/audit-mac-dmg.mjs",
  "scripts/check-packaging-environment.mjs",
  "scripts/create-reference-hash-manifest.mjs",
  "scripts/clean-release.mjs",
  "scripts/packaging-audit-lib.mjs",
  "scripts/prepare-packaging-runtime.mjs",
  "scripts/verify-mac-build-kit.mjs",
  "scripts/verify-built-renderer.mjs",
];
const externalFiles = [
  [path.join(piagentRoot, "pi-soft-furnish-agent", "package.json"), path.join(outputRoot, "pi-soft-furnish-agent", "package.json")],
  [path.join(piagentRoot, "pi-soft-furnish-agent", "extensions", "soft-furnish.ts"), path.join(outputRoot, "pi-soft-furnish-agent", "extensions", "soft-furnish.ts")],
  [path.join(piagentRoot, "pi-soft-furnish-agent", "data", "style-recipes.json"), path.join(outputRoot, "pi-soft-furnish-agent", "data", "style-recipes.json")],
  [path.join(piagentRoot, "scripts", "build-zhuyan-mac-arm64.command"), path.join(outputRoot, "build-zhuyan-mac-arm64.command")],
  [manifestSource, path.join(desktopOutput, "private-audit-input", "reference-library-sha256.json")],
];

async function copy(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const content = await readFile(destination);
  return { path: path.relative(outputRoot, destination).split(path.sep).join("/"), bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") };
}

await readFile(manifestSource, "utf8").then((text) => {
  const value = JSON.parse(text);
  if (value.schemaVersion !== 1 || !Number.isInteger(value.sourceImageCount) || value.sourceImageCount < 1 || !Array.isArray(value.sha256) || value.sha256.length < 1) {
    throw new Error("Private reference hash manifest is missing or invalid; generate it before preparing the Mac build kit");
  }
});
const desktopPackage = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8"));
const runtimePackage = JSON.parse(await readFile(path.join(piagentRoot, "pi-soft-furnish-agent", "package.json"), "utf8"));
if (desktopPackage.version !== expectedDesktopVersion) throw new Error(`Unexpected Desktop version for Mac build kit: ${desktopPackage.version}`);
if (runtimePackage.version !== expectedRuntimeVersion) throw new Error(`Unexpected Runtime version for Mac build kit: ${runtimePackage.version}`);

await rm(outputRoot, { recursive: true, force: true });
const copied = [];
for (const relative of desktopFiles) copied.push(await copy(path.join(desktopRoot, ...relative.split("/")), path.join(desktopOutput, ...relative.split("/"))));
for (const [source, destination] of externalFiles) copied.push(await copy(source, destination));
copied.sort((left, right) => left.path.localeCompare(right.path));
const kitManifest = {
  schemaVersion: 1,
  purpose: "Zhuyan AI macOS arm64 private build kit whitelist",
  generatedAt: new Date().toISOString(),
  desktopVersion: expectedDesktopVersion,
  runtimeVersion: expectedRuntimeVersion,
  containsProviderCredentials: false,
  containsReferenceImageBytes: false,
  containsUserProjects: false,
  files: copied,
};
await writeFile(path.join(outputRoot, "build-kit-manifest.json"), `${JSON.stringify(kitManifest, null, 2)}\n`, "utf8");
console.log("ZHUYAN_MAC_ARM64_BUILD_KIT_OK");
console.log(`OUTPUT: ${outputRoot}`);
console.log(`FILES: ${copied.length + 1}`);
console.log(`DESKTOP_VERSION: ${expectedDesktopVersion}`);
console.log(`RUNTIME_VERSION: ${expectedRuntimeVersion}`);
console.log("REFERENCE_IMAGE_BYTES: 0");
console.log("PROVIDER_CREDENTIALS: 0");
console.log("USER_PROJECTS: 0");
