import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = path.join(projectRoot, "dist-renderer");
const indexPath = path.join(rendererRoot, "index.html");
const html = await readFile(indexPath, "utf8");

const resourceReferences = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
const absoluteLocalReferences = resourceReferences.filter((value) => value.startsWith("/") && !value.startsWith("//"));
if (absoluteLocalReferences.length > 0) {
  throw new Error(`Packaged Renderer contains file-incompatible absolute resource paths: ${absoluteLocalReferences.join(", ")}`);
}

const relativeAssets = resourceReferences.filter((value) => value.startsWith("./assets/") || value.startsWith("assets/"));
if (relativeAssets.length < 2) throw new Error("Packaged Renderer is missing relative JavaScript/CSS asset references");
for (const reference of relativeAssets) {
  const cleanReference = reference.replace(/^\.\//, "").split(/[?#]/, 1)[0];
  await access(path.join(rendererRoot, ...cleanReference.split("/")));
}

console.log("ZHUYAN_RENDERER_FILE_PATHS_OK");
console.log(`RELATIVE_ASSETS_VERIFIED: ${relativeAssets.length}`);
