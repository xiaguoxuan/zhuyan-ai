import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".svg"]);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceInput = process.argv[2] || process.env.ZHUYAN_FORBIDDEN_REFERENCE_ROOT || "";
if (!sourceInput) throw new Error("A specific read-only reference library root is required");
const sourceRoot = path.resolve(sourceInput);
const outputFile = path.resolve(process.argv[3] || path.join(projectRoot, "private-audit-input", "reference-library-sha256.json"));

if (sourceRoot === path.parse(sourceRoot).root) throw new Error("A specific read-only reference library root is required");
const sourceInfo = await stat(sourceRoot);
if (!sourceInfo.isDirectory()) throw new Error("Reference library root must be a directory");

async function walk(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

const imageFiles = await walk(sourceRoot);
if (imageFiles.length < 1) throw new Error("Reference library contains no supported images");
const hashes = [];
for (const file of imageFiles) hashes.push(createHash("sha256").update(await readFile(file)).digest("hex"));
const uniqueHashes = [...new Set(hashes)].sort();
const manifest = {
  schemaVersion: 1,
  purpose: "Private exact-hash audit input for rights-uncleared reference images; contains no source paths or image bytes",
  generatedAt: new Date().toISOString(),
  sourceImageCount: imageFiles.length,
  uniqueHashCount: uniqueHashes.length,
  sha256: uniqueHashes,
};
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
const manifestSha256 = createHash("sha256").update(await readFile(outputFile)).digest("hex");
console.log("ZHUYAN_REFERENCE_HASH_MANIFEST_OK");
console.log(`SOURCE_IMAGES_HASHED: ${imageFiles.length}`);
console.log(`UNIQUE_SHA256: ${uniqueHashes.length}`);
console.log(`MANIFEST: ${outputFile}`);
console.log(`MANIFEST_SHA256: ${manifestSha256}`);
console.log("SOURCE_PATHS_PERSISTED: 0");
console.log("SOURCE_IMAGES_COPIED: 0");
