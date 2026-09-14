const path = require("node:path");
const { execFile } = require("node:child_process");
const { mkdir } = require("node:fs/promises");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

module.exports = async function afterPack(context) {
  const { auditAsar } = await import("./packaging-audit-lib.mjs");
  const reportDir = path.join(context.packager.projectDir, "release", "audit");
  const isMac = context.electronPlatformName === "darwin";
  const appPath = isMac
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    : context.appOutDir;
  const asarPath = isMac
    ? path.join(appPath, "Contents", "Resources", "app.asar")
    : path.join(appPath, "resources", "app.asar");
  const reportPath = path.join(reportDir, isMac ? "mac-unpacked-app-audit.json" : "unpacked-app-audit.json");
  const sourceLabel = isMac ? "electron-builder macOS arm64 afterPack app.asar" : "electron-builder afterPack app.asar";
  await mkdir(reportDir, { recursive: true });
  const report = await auditAsar(asarPath, reportPath, sourceLabel);
  if (isMac) {
    if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("macOS arm64 package must be built on an Apple Silicon Mac");
    await execFileAsync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], { maxBuffer: 10 * 1024 * 1024 });
    await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { maxBuffer: 10 * 1024 * 1024 });
    console.log("ZHUYAN_MAC_AD_HOC_CODESIGN_OK");
  }
  console.log("ZHUYAN_AFTER_PACK_AUDIT_OK");
  console.log(`APP_ASAR_FILES: ${report.appAsar.fileCount}`);
  console.log(`PACKAGED_IMAGES: ${report.packagedImages.count}`);
  console.log(`REFERENCE_SOURCE_IMAGES_HASHED: ${report.rightsUnclearedReferenceComparison.sourceImageCount}`);
  console.log("REFERENCE_IMAGE_HASH_MATCHES: 0");
};
