import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await rm(path.join(projectRoot, "release"), { recursive: true, force: true });
console.log("ZHUYAN_RELEASE_CLEAN_OK");
