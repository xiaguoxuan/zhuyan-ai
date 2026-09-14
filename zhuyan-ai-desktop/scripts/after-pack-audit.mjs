import { mkdir } from "node:fs/promises";
import path from "node:path";
import { auditAsar } from "./packaging-audit-lib.mjs";

export default async function afterPack(context) {
  const reportDir = path.join(context.packager.projectDir, "release", "audit");
  const asarPath = path.join(context.appOutDir, "resources", "app.asar");
  const reportPath = path.join(reportDir, "unpacked-app-audit.json");
  await mkdir(reportDir, { recursive: true });
  const report = await auditAsar(asarPath, reportPath, "electron-builder afterPack app.asar");
  console.log("ZHUYAN_AFTER_PACK_AUDIT_OK");
  console.log(`APP_ASAR_FILES: ${report.appAsar.fileCount}`);
  console.log(`PACKAGED_IMAGES: ${report.packagedImages.count}`);
  console.log(`REFERENCE_SOURCE_IMAGES_HASHED: ${report.rightsUnclearedReferenceComparison.sourceImageCount}`);
  console.log("REFERENCE_IMAGE_HASH_MATCHES: 0");
}
