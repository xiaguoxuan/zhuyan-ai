import { execFile } from "node:child_process";
import { mkdir, mkdtemp, open, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { auditAsar, auditLooseImagesAgainstReferences, exists, sha256File, walkFiles } from "./packaging-audit-lib.mjs";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const releaseDir = path.join(projectRoot, "release");
const auditDir = path.join(releaseDir, "audit");

if (process.platform !== "darwin") throw new Error("Final DMG audit must run on macOS");
if (process.arch !== "arm64") throw new Error(`Apple Silicon audit host required; current architecture is ${process.arch}`);

async function findDmg() {
  const candidates = (await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /mac-arm64\.dmg$/i.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name));
  if (candidates.length !== 1) throw new Error(`Expected exactly one arm64 DMG, found ${candidates.length}`);
  return candidates[0];
}

function plistMountPoint(plistText) {
  const matches = [...plistText.matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)];
  const value = matches.at(-1)?.[1];
  return value?.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

async function attachDmg(dmg) {
  const { stdout } = await execFileAsync("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noverify", "-plist", dmg], { maxBuffer: 10 * 1024 * 1024 });
  const mountPoint = plistMountPoint(stdout);
  if (!mountPoint) throw new Error("Could not determine mounted DMG path");
  return mountPoint;
}

const MACH_O_MAGICS = new Set([0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);

async function hasMachOMagic(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    return bytesRead === 4 && MACH_O_MAGICS.has(buffer.readUInt32BE(0));
  } finally {
    await handle.close();
  }
}

async function auditMachOArchitectures(appPath) {
  const files = await walkFiles(path.join(appPath, "Contents"));
  let machOCount = 0;
  const invalid = [];
  for (const file of files) {
    if (!await hasMachOMagic(file.absolute).catch(() => false)) continue;
    const architectures = (await execFileAsync("/usr/bin/lipo", ["-archs", file.absolute], { maxBuffer: 2 * 1024 * 1024 })).stdout.trim().split(/\s+/);
    machOCount += 1;
    if (!architectures.includes("arm64")) invalid.push(file.relative);
  }
  if (machOCount < 1) throw new Error("No Mach-O executable was found in the mounted app");
  if (invalid.length > 0) throw new Error(`Non-arm64 Mach-O files found: ${invalid.join(", ")}`);
  return { machOCount, invalidArchitectureCount: 0 };
}

const dmg = await findDmg();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zhuyan-mac-audit-"));
let mountPoint;
try {
  mountPoint = await attachDmg(dmg);
  const apps = (await readdir(mountPoint, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(mountPoint, entry.name));
  if (apps.length !== 1) throw new Error(`Expected exactly one app bundle in DMG, found ${apps.length}`);
  const appPath = apps[0];
  const appAsar = path.join(appPath, "Contents", "Resources", "app.asar");
  if (!await exists(appAsar)) throw new Error("Mounted app does not contain Contents/Resources/app.asar");

  await mkdir(auditDir, { recursive: true });
  const appReport = await auditAsar(appAsar, path.join(auditDir, "mac-dmg-app-audit.json"), "final macOS arm64 DMG app.asar");
  const looseImageReport = await auditLooseImagesAgainstReferences(path.join(appPath, "Contents"));
  const architecture = await auditMachOArchitectures(appPath);
  const codeSignVerify = await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { maxBuffer: 10 * 1024 * 1024 })
    .then(() => ({ valid: true }))
    .catch((error) => ({ valid: false, error: String(error.stderr || error.message).slice(0, 500) }));
  if (!codeSignVerify.valid) throw new Error(`macOS app code signature validation failed: ${codeSignVerify.error}`);
  const signatureDisplay = await execFileAsync("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], { maxBuffer: 10 * 1024 * 1024 })
    .then(({ stderr }) => stderr)
    .catch(() => "");
  const signatureKind = /Authority=Developer ID Application:/.test(signatureDisplay) ? "developer_id" : "ad_hoc";
  const report = {
    schemaVersion: 1,
    status: "passed",
    auditedAt: new Date().toISOString(),
    artifact: { fileName: path.basename(dmg), sha256: await sha256File(dmg), platform: "darwin", architecture: "arm64" },
    embeddedAppAsarSha256: appReport.appAsar.sha256,
    packagedImageCount: appReport.packagedImages.count,
    appBundleLooseImageCount: looseImageReport.imageCount,
    rightsUnclearedReferenceSourceImageCount: Math.max(appReport.rightsUnclearedReferenceComparison.sourceImageCount, looseImageReport.sourceImageCount),
    rightsUnclearedReferenceExactHashMatches: 0,
    providerCredentialFiles: 0,
    architecture,
    codeSignature: { valid: true, kind: signatureKind, notarizationVerified: false },
  };
  await writeFile(path.join(auditDir, "mac-dmg-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("ZHUYAN_MAC_DMG_AUDIT_OK");
  console.log(`DMG: ${report.artifact.fileName}`);
  console.log(`DMG_SHA256: ${report.artifact.sha256}`);
  console.log("ARCHITECTURE: arm64");
  console.log(`MACH_O_FILES: ${architecture.machOCount}`);
  console.log(`PACKAGED_IMAGES_IN_APP_ASAR: ${report.packagedImageCount}`);
  console.log(`LOOSE_IMAGES_IN_APP_BUNDLE: ${report.appBundleLooseImageCount}`);
  console.log(`REFERENCE_SOURCE_IMAGES_HASHED: ${report.rightsUnclearedReferenceSourceImageCount}`);
  console.log("REFERENCE_IMAGE_HASH_MATCHES: 0");
  console.log("PROVIDER_CREDENTIAL_FILES: 0");
  console.log(`CODE_SIGNATURE: ${signatureKind}`);
  console.log("NOTARIZATION_VERIFIED: false");
} finally {
  if (mountPoint) await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint], { maxBuffer: 10 * 1024 * 1024 }).catch(() => {});
  await rm(temporaryRoot, { recursive: true, force: true });
}
