import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { extractAll } = require("@electron/asar");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif", ".svg", ".ico", ".icns"]);
const TEXT_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".json", ".html", ".css", ".md", ".txt", ".yml", ".yaml"]);
const APP_TOP_LEVEL_ALLOWLIST = new Set(["dist-electron", "dist-renderer", "node_modules", "package.json", "packaging"]);
const RUNTIME_ALLOWLIST = new Set([
  "packaging/runtime/pi-soft-furnish-agent/extensions/soft-furnish.ts",
  "packaging/runtime/pi-soft-furnish-agent/data/style-recipes.json",
  "packaging/runtime/runtime-manifest.json",
]);
const APP_OWNED_PREFIXES = ["dist-electron/", "dist-renderer/", "packaging/"];
const FORBIDDEN_APP_PATH_NAMES = new Set([
  ".env", "auth.json", "models.json", "provider-settings.json", "project.json", "tool-runs.jsonl",
]);
const BASE_FORBIDDEN_TEXT_PATTERNS = [
  { label: "Windows development path", pattern: /[A-Za-z]:\\(?:Users|Documents and Settings|workspace|projects?)\\/gi },
  { label: "macOS build user path", pattern: /\/Users\/[^/\s"']+/g },
  { label: "inline base64 image", pattern: /data:image\/[a-z0-9.+-]+;base64,/gi },
  { label: "OpenAI-style API key", pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { label: "Google-style API key", pattern: /AIza[A-Za-z0-9_-]{20,}/g },
  { label: "JWT-like credential", pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forbiddenTextPatterns() {
  const configured = process.env.ZHUYAN_FORBIDDEN_TEXT_TERMS;
  if (!configured) return BASE_FORBIDDEN_TEXT_PATTERNS;
  const terms = configured.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
  return [
    ...BASE_FORBIDDEN_TEXT_PATTERNS,
    ...terms.map((term) => ({ label: "configured private term", pattern: new RegExp(escapeRegex(term), "gi") })),
  ];
}

export async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function walkFiles(root, prefix = "") {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute, relative));
    else if (entry.isFile()) files.push({ relative, absolute });
  }
  return files;
}

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function imageFile(file) {
  return IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export async function auditLooseImagesAgainstReferences(root) {
  const images = (await walkFiles(root)).filter((item) => imageFile(item.relative));
  const references = await collectReferenceHashes();
  if (process.env.ZHUYAN_REQUIRE_REFERENCE_LIBRARY === "1" && references.sourcesAvailable === 0) {
    throw new Error("Rights-uncleared reference library or approved hash manifest is required for artifact image audit but was not available");
  }
  const hashes = [];
  const matches = [];
  for (const image of images) {
    const hash = await sha256File(image.absolute);
    hashes.push(hash);
    if (references.hashes.has(hash)) matches.push(image.relative);
  }
  if (matches.length > 0) throw new Error(`Rights-uncleared reference image hash found in extracted installer: ${matches.join(", ")}`);
  return {
    imageCount: images.length,
    sha256: [...new Set(hashes)].sort(),
    sourceImageCount: references.imageCount,
    exactHashMatches: 0,
  };
}

function appOwned(relative) {
  return relative === "package.json" || APP_OWNED_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

function defaultSensitiveConfigPaths() {
  const configured = process.env.ZHUYAN_SENSITIVE_CONFIG_PATHS;
  return configured ? configured.split(path.delimiter).map((item) => item.trim()).filter(Boolean) : [];
}

function collectJsonSecrets(value, output) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonSecrets(item, output);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /(api.?key|token|secret|password|authorization|credential)/i.test(key) && item.length >= 8) output.add(item);
    else collectJsonSecrets(item, output);
  }
}

async function collectKnownDevelopmentSecrets() {
  const secrets = new Set();
  let sourceFilesRead = 0;
  for (const file of defaultSensitiveConfigPaths()) {
    if (!await exists(file)) continue;
    const text = await readFile(file, "utf8");
    sourceFilesRead += 1;
    if (path.extname(file).toLowerCase() === ".json") {
      try { collectJsonSecrets(JSON.parse(text), secrets); } catch { /* Corrupt local config remains covered by generic patterns. */ }
    } else {
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || !/(api.?key|token|secret|password|authorization|credential)/i.test(match[1])) continue;
        const value = match[2].trim().replace(/^['"]|['"]$/g, "");
        if (value.length >= 8) secrets.add(value);
      }
    }
  }
  return { secrets, sourceFilesRead };
}

function defaultReferenceRoots() {
  const configured = process.env.ZHUYAN_FORBIDDEN_REFERENCE_ROOTS;
  return configured ? configured.split(path.delimiter).map((item) => item.trim()).filter(Boolean) : [];
}

function defaultReferenceHashManifests() {
  const configured = process.env.ZHUYAN_FORBIDDEN_REFERENCE_HASH_MANIFESTS;
  if (!configured) return [];
  return configured.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function parseReferenceHashManifest(value, file) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1) throw new Error(`Invalid reference hash manifest: ${path.basename(file)}`);
  if (!Number.isInteger(value.sourceImageCount) || value.sourceImageCount < 1) throw new Error(`Invalid reference image count in hash manifest: ${path.basename(file)}`);
  if (!Array.isArray(value.sha256) || value.sha256.length < 1) throw new Error(`Reference hash manifest is empty: ${path.basename(file)}`);
  const hashes = value.sha256.map((hash) => {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Invalid SHA-256 in reference hash manifest: ${path.basename(file)}`);
    return hash;
  });
  return { sourceImageCount: value.sourceImageCount, hashes };
}

async function collectReferenceHashes() {
  const hashes = new Set();
  const roots = defaultReferenceRoots();
  const hashManifests = defaultReferenceHashManifests();
  let rootsAvailable = 0;
  let rootImageCount = 0;
  for (const root of roots) {
    if (!await exists(root)) continue;
    rootsAvailable += 1;
    for (const file of await walkFiles(root)) {
      if (!imageFile(file.relative)) continue;
      hashes.add(await sha256File(file.absolute));
      rootImageCount += 1;
    }
  }

  let hashManifestsAvailable = 0;
  let manifestImageCount = 0;
  if (rootsAvailable === 0) {
    for (const manifestPath of hashManifests) {
      if (!await exists(manifestPath)) continue;
      const manifest = parseReferenceHashManifest(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath);
      hashManifestsAvailable += 1;
      manifestImageCount += manifest.sourceImageCount;
      for (const hash of manifest.hashes) hashes.add(hash);
    }
  }
  return {
    hashes,
    rootsConfigured: roots.length,
    rootsAvailable,
    hashManifestsConfigured: hashManifests.length,
    hashManifestsAvailable,
    sourcesAvailable: rootsAvailable + hashManifestsAvailable,
    imageCount: rootsAvailable > 0 ? rootImageCount : manifestImageCount,
  };
}

function assertTopLevel(files) {
  const roots = new Set(files.map((item) => item.relative.split("/")[0]));
  const unexpected = [...roots].filter((item) => !APP_TOP_LEVEL_ALLOWLIST.has(item));
  if (unexpected.length > 0) throw new Error(`Unexpected app.asar top-level entries: ${unexpected.join(", ")}`);
}

function assertForbiddenFileNames(files) {
  const forbidden = files.map((item) => item.relative).filter((relative) => {
    const basename = path.posix.basename(relative).toLowerCase();
    return FORBIDDEN_APP_PATH_NAMES.has(basename) || basename.startsWith(".env.");
  });
  if (forbidden.length > 0) throw new Error(`Forbidden sensitive files detected in package: ${forbidden.join(", ")}`);
}

function assertRuntimeWhitelist(files) {
  const runtimeFiles = files.map((item) => item.relative).filter((relative) => relative.startsWith("packaging/runtime/"));
  const unexpected = runtimeFiles.filter((relative) => !RUNTIME_ALLOWLIST.has(relative));
  const missing = [...RUNTIME_ALLOWLIST].filter((relative) => !runtimeFiles.includes(relative));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(`Packaged runtime whitelist mismatch; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`);
  }
  const runtimeImages = runtimeFiles.filter(imageFile);
  if (runtimeImages.length > 0) throw new Error(`Reference images are forbidden in packaged runtime: ${runtimeImages.join(", ")}`);
}

async function scanAppOwnedText(files) {
  const findings = [];
  for (const file of files) {
    if (!appOwned(file.relative) || !TEXT_EXTENSIONS.has(path.extname(file.relative).toLowerCase())) continue;
    if ((await stat(file.absolute)).size > 8 * 1024 * 1024) continue;
    const text = await readFile(file.absolute, "utf8");
    for (const rule of forbiddenTextPatterns()) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(text)) findings.push({ file: file.relative, rule: rule.label });
    }
  }
  if (findings.length > 0) {
    throw new Error(`Sensitive app-owned content detected: ${findings.map((item) => `${item.file} (${item.rule})`).join(", ")}`);
  }
}

async function assertKnownSecretsAbsent(files, secrets) {
  if (secrets.size === 0) return;
  for (const file of files) {
    const content = await readFile(file.absolute);
    for (const secret of secrets) {
      if (content.includes(Buffer.from(secret, "utf8"))) throw new Error(`Exact known development credential detected in package file: ${file.relative}`);
    }
  }
}

export async function auditAsar(asarPath, reportPath, sourceLabel) {
  if (!await exists(asarPath)) throw new Error(`app.asar not found for ${sourceLabel}`);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zhuyan-asar-audit-"));
  const extractedRoot = path.join(temporaryRoot, "app");
  try {
    extractAll(asarPath, extractedRoot);
    const files = await walkFiles(extractedRoot);
    const knownDevelopmentSecrets = await collectKnownDevelopmentSecrets();
    assertTopLevel(files);
    assertForbiddenFileNames(files);
    assertRuntimeWhitelist(files);
    await scanAppOwnedText(files);
    await assertKnownSecretsAbsent(files, knownDevelopmentSecrets.secrets);

    const packagedImages = files.filter((item) => imageFile(item.relative));
    const packagedImageHashes = new Map();
    for (const image of packagedImages) packagedImageHashes.set(image.relative, await sha256File(image.absolute));
    const references = await collectReferenceHashes();
    if (process.env.ZHUYAN_REQUIRE_REFERENCE_LIBRARY === "1" && references.sourcesAvailable === 0) {
      throw new Error("Rights-uncleared reference library or approved hash manifest is required for release audit but was not available");
    }
    const matches = [...packagedImageHashes].filter(([, hash]) => references.hashes.has(hash)).map(([relative]) => relative);
    if (matches.length > 0) throw new Error(`Rights-uncleared reference image hash found in package: ${matches.join(", ")}`);

    const asarHash = await sha256File(asarPath);
    const report = {
      schemaVersion: 1,
      status: "passed",
      source: sourceLabel,
      auditedAt: new Date().toISOString(),
      appAsar: { sha256: asarHash, fileCount: files.length },
      packagedImages: { count: packagedImages.length, sha256: [...packagedImageHashes.values()].sort() },
      rightsUnclearedReferenceComparison: {
        rootsConfigured: references.rootsConfigured,
        rootsAvailable: references.rootsAvailable,
        hashManifestsConfigured: references.hashManifestsConfigured,
        hashManifestsAvailable: references.hashManifestsAvailable,
        sourceImageCount: references.imageCount,
        exactHashMatches: 0,
      },
      packagedRuntime: {
        exactWhitelistEnforced: true,
        referenceImageCount: 0,
        providerCredentialFileCount: 0,
      },
      sensitiveContentScan: {
        status: "passed",
        appOwnedTextFilesScanned: true,
        forbiddenFileNamesScannedAcrossEntireAsar: true,
        localCredentialSourceFilesReadWithoutPersistingValues: knownDevelopmentSecrets.sourceFilesRead,
        exactKnownCredentialMatches: 0,
      },
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
