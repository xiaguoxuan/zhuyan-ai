import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { auditAsar, auditLooseImagesAgainstReferences, exists, sha256File, walkFiles } from "./packaging-audit-lib.mjs";

const require = createRequire(import.meta.url);
const { path7za: sevenZip } = require("7zip-bin");
const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const releaseDir = path.join(projectRoot, "release");
const auditDir = path.join(releaseDir, "audit");

async function findInstaller() {
  const candidates = (await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /Setup.*\.exe$/i.test(entry.name))
    .map((entry) => path.join(releaseDir, entry.name));
  if (candidates.length !== 1) throw new Error(`Expected exactly one NSIS installer, found ${candidates.length}`);
  return candidates[0];
}

async function extract(archive, output) {
  await mkdir(output, { recursive: true });
  await execFileAsync(sevenZip, ["x", "-y", `-o${output}`, archive], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}

async function findAppAsar(root) {
  const direct = (await walkFiles(root)).find((file) => file.relative.endsWith("resources/app.asar"));
  if (direct) return direct.absolute;
  const nestedArchives = (await walkFiles(root)).filter((file) => /(^|\/)(app-64|app-32|app-arm64)\.7z$/i.test(file.relative));
  for (let index = 0; index < nestedArchives.length; index += 1) {
    const nestedRoot = path.join(root, `nested-${index}`);
    await extract(nestedArchives[index].absolute, nestedRoot);
    const found = (await walkFiles(nestedRoot)).find((file) => file.relative.endsWith("resources/app.asar"));
    if (found) return found.absolute;
  }
  throw new Error("Could not locate resources/app.asar inside NSIS installer");
}

if (!await exists(sevenZip)) throw new Error("7zip-bin executable is missing; run npm install");
const installer = await findInstaller();
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zhuyan-installer-audit-"));
try {
  const extractedInstaller = path.join(temporaryRoot, "installer");
  await extract(installer, extractedInstaller);
  const appAsar = await findAppAsar(extractedInstaller);
  await mkdir(auditDir, { recursive: true });
  const looseImageReport = await auditLooseImagesAgainstReferences(extractedInstaller);
  const appReport = await auditAsar(appAsar, path.join(auditDir, "installer-app-audit.json"), "final NSIS installer app.asar");
  const installerReport = {
    schemaVersion: 1,
    status: "passed",
    auditedAt: new Date().toISOString(),
    installer: {
      fileName: path.basename(installer),
      sha256: await sha256File(installer),
    },
    embeddedAppAsarSha256: appReport.appAsar.sha256,
    packagedImageCount: appReport.packagedImages.count,
    extractedInstallerLooseImageCount: looseImageReport.imageCount,
    rightsUnclearedReferenceSourceImageCount: Math.max(appReport.rightsUnclearedReferenceComparison.sourceImageCount, looseImageReport.sourceImageCount),
    rightsUnclearedReferenceExactHashMatches: 0,
    providerCredentialFiles: 0,
  };
  await writeFile(path.join(auditDir, "installer-audit.json"), `${JSON.stringify(installerReport, null, 2)}\n`, "utf8");
  console.log("ZHUYAN_INSTALLER_AUDIT_OK");
  console.log(`INSTALLER: ${installerReport.installer.fileName}`);
  console.log(`INSTALLER_SHA256: ${installerReport.installer.sha256}`);
  console.log(`PACKAGED_IMAGES_IN_APP_ASAR: ${installerReport.packagedImageCount}`);
  console.log(`LOOSE_IMAGES_IN_EXTRACTED_INSTALLER: ${installerReport.extractedInstallerLooseImageCount}`);
  console.log(`REFERENCE_SOURCE_IMAGES_HASHED: ${installerReport.rightsUnclearedReferenceSourceImageCount}`);
  console.log("REFERENCE_IMAGE_HASH_MATCHES: 0");
  console.log("PROVIDER_CREDENTIAL_FILES: 0");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
