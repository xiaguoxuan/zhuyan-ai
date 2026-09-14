import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const sourceRoot = path.resolve(process.env.ZHUYAN_SOFT_FURNISH_PACKAGE || path.join(projectRoot, "..", "pi-soft-furnish-agent"));
const stagingRoot = path.join(projectRoot, "packaging", "runtime");
const packageRoot = path.join(stagingRoot, "pi-soft-furnish-agent");
const allowedSources = [
  ["extensions/soft-furnish.ts", "extensions/soft-furnish.ts"],
  ["data/style-recipes.json", "data/style-recipes.json"],
];
const forbiddenExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".ico", ".pdf"]);
const forbiddenNames = new Set([".env", "auth.json", "models.json", "provider-settings.json", "project.json", "tool-runs.jsonl"]);

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function assertRegularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Packaging source must be a regular file: ${path.basename(file)}`);
}

async function walk(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in packaging runtime: ${relative}`);
    if (entry.isDirectory()) files.push(...await walk(absolute, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unsupported packaging entry: ${relative}`);
  }
  return files.sort();
}

const sourcePackage = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
if (sourcePackage.version !== "0.8.2") {
  throw new Error(`Unexpected soft-furnish Runtime version: ${sourcePackage.version}`);
}

await rm(stagingRoot, { recursive: true, force: true });
const manifestFiles = [];
for (const [sourceRelative, targetRelative] of allowedSources) {
  const source = path.join(sourceRoot, ...sourceRelative.split("/"));
  const target = path.join(packageRoot, ...targetRelative.split("/"));
  await assertRegularFile(source);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  const content = await readFile(target);
  manifestFiles.push({ path: `pi-soft-furnish-agent/${targetRelative}`, bytes: content.byteLength, sha256: sha256(content) });
}

const manifest = {
  schemaVersion: 1,
  purpose: "Zhuyan AI packaged deterministic soft-furnishing business runtime",
  generatedAt: new Date().toISOString(),
  sourcePackageVersion: sourcePackage.version,
  containsReferenceImages: false,
  containsProviderCredentials: false,
  files: manifestFiles,
};
await writeFile(path.join(stagingRoot, "runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const stagedFiles = await walk(stagingRoot);
const expected = [...manifestFiles.map((item) => item.path), "runtime-manifest.json"].sort();
if (JSON.stringify(stagedFiles) !== JSON.stringify(expected)) {
  throw new Error(`Packaging runtime whitelist mismatch: ${stagedFiles.join(", ")}`);
}
for (const relative of stagedFiles) {
  const lower = relative.toLowerCase();
  const basename = path.posix.basename(lower);
  if (forbiddenExtensions.has(path.posix.extname(lower))) throw new Error(`Images are forbidden in packaging runtime: ${relative}`);
  if (forbiddenNames.has(basename) || basename.startsWith(".env.")) throw new Error(`Sensitive file is forbidden in packaging runtime: ${relative}`);
}

console.log("ZHUYAN_PACKAGING_RUNTIME_OK");
console.log(`FILES: ${stagedFiles.join(", ")}`);
console.log("REFERENCE_IMAGES: 0");
console.log("PROVIDER_CREDENTIALS: 0");
