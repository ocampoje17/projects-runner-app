import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [packageJson, tauriConfig] = await Promise.all([
  readJson(new URL("../package.json", import.meta.url)),
  readJson(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
]);

const packageVersion = packageJson.version;
const tauriVersion = tauriConfig.version;

if (!packageVersion || !tauriVersion) {
  throw new Error("Unable to read version from package.json or src-tauri/tauri.conf.json.");
}

if (packageVersion !== tauriVersion) {
  throw new Error(
    `Version mismatch: package.json=${packageVersion} but src-tauri/tauri.conf.json=${tauriVersion}`,
  );
}

console.log(`Version sync OK: ${packageVersion}`);
