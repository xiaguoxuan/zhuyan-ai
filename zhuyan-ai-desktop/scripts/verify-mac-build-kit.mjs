import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const kitRoot = path.resolve(process.argv[2] || defaultRoot);
const manifestPath = path.join(kitRoot, "build-kit-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const expectedDesktopVersion = "0.10.4";
const expectedRuntimeVersion = "0.8.2";
if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) throw new Error("Invalid Mac build-kit manifest");
if (manifest.desktopVersion !== expectedDesktopVersion || manifest.runtimeVersion !== expectedRuntimeVersion) {
  throw new Error(`Mac build-kit version mismatch: Desktop=${manifest.desktopVersion || "missing"}, Runtime=${manifest.runtimeVersion || "missing"}`);
}
if (manifest.containsProviderCredentials !== false || manifest.containsReferenceImageBytes !== false || manifest.containsUserProjects !== false) {
  throw new Error("Mac build-kit safety declaration is invalid");
}

async function walk(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(root, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`Symbolic links are forbidden in Mac build kit: ${relative}`);
    if (info.isDirectory()) files.push(...await walk(absolute, relative));
    else if (info.isFile()) files.push(relative);
    else throw new Error(`Unsupported Mac build-kit entry: ${relative}`);
  }
  return files.sort();
}

const expected = new Map();
for (const item of manifest.files) {
  if (!item || typeof item.path !== "string" || !Number.isInteger(item.bytes) || typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) {
    throw new Error("Invalid file entry in Mac build-kit manifest");
  }
  if (item.path.startsWith("/") || item.path.includes("..") || expected.has(item.path)) throw new Error(`Unsafe or duplicate build-kit path: ${item.path}`);
  expected.set(item.path, item);
}
const actualFiles = await walk(kitRoot);
const allowedFiles = [...expected.keys(), "build-kit-manifest.json"].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(allowedFiles)) {
  const unexpected = actualFiles.filter((file) => !allowedFiles.includes(file));
  const missing = allowedFiles.filter((file) => !actualFiles.includes(file));
  throw new Error(`Mac build-kit whitelist mismatch; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`);
}
for (const [relative, expectedFile] of expected) {
  const content = await readFile(path.join(kitRoot, ...relative.split("/")));
  if (content.byteLength !== expectedFile.bytes) throw new Error(`Mac build-kit file size mismatch: ${relative}`);
  const hash = createHash("sha256").update(content).digest("hex");
  if (hash !== expectedFile.sha256) throw new Error(`Mac build-kit SHA-256 mismatch: ${relative}`);
}
const desktopPackage = JSON.parse(await readFile(path.join(kitRoot, "zhuyan-ai-desktop", "package.json"), "utf8"));
const runtimePackage = JSON.parse(await readFile(path.join(kitRoot, "pi-soft-furnish-agent", "package.json"), "utf8"));
if (desktopPackage.version !== expectedDesktopVersion) throw new Error(`Unexpected Desktop version in Mac build kit: ${desktopPackage.version}`);
if (runtimePackage.version !== expectedRuntimeVersion) throw new Error(`Unexpected Runtime version in Mac build kit: ${runtimePackage.version}`);
console.log("ZHUYAN_MAC_BUILD_KIT_VERIFIED");
console.log(`FILES: ${expected.size + 1}`);
console.log(`DESKTOP_VERSION: ${expectedDesktopVersion}`);
console.log(`RUNTIME_VERSION: ${expectedRuntimeVersion}`);
console.log("UNEXPECTED_FILES: 0");
console.log("SHA256_MISMATCHES: 0");
