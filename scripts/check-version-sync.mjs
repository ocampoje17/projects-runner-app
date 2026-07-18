import { readFile } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [packageJson, tauriConfig, cargoToml] = await Promise.all([
  readJson(new URL("../package.json", import.meta.url)),
  readJson(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
  readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8"),
]);

const packageVersion = packageJson.version;
const tauriVersion = tauriConfig.version;
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (!packageVersion || !tauriVersion || !cargoVersion) {
  throw new Error("Unable to read version from package.json, src-tauri/tauri.conf.json, or src-tauri/Cargo.toml.");
}

if (packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
  throw new Error(
    `Version mismatch: package.json=${packageVersion}, src-tauri/tauri.conf.json=${tauriVersion}, src-tauri/Cargo.toml=${cargoVersion}`,
  );
}

console.log(`Version sync OK: ${packageVersion}`);
