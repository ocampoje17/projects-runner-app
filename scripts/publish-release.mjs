import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    fail(stderr || `Command failed: ${command} ${args.join(" ")}`);
  }

  return result.stdout.trim();
}

function isValidVersion(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const version = process.argv[2];

if (!version) {
  fail("Usage: npm run release:publish -- <version>");
}

if (!isValidVersion(version)) {
  fail(`Invalid version '${version}'. Expected a semantic version like 0.4.7.`);
}

const branch = capture("git", ["branch", "--show-current"]);
if (branch !== "master") {
  fail(`Release publishing must run from 'master'. Current branch is '${branch}'.`);
}

const status = capture("git", ["status", "--short"]);
if (status) {
  fail("Working tree must be clean before publishing a release.");
}

const tag = `app-v${version}`;

run("git", ["fetch", "--tags", "origin"]);

const localTags = capture("git", ["tag", "--list", tag]);
if (localTags) {
  fail(`Tag '${tag}' already exists locally.`);
}

const remoteTag = capture("git", ["ls-remote", "--tags", "origin", tag]);
if (remoteTag) {
  fail(`Tag '${tag}' already exists on origin.`);
}

const packageJsonPath = new URL("../package.json", import.meta.url);
const packageLockPath = new URL("../package-lock.json", import.meta.url);
const tauriConfigPath = new URL("../src-tauri/tauri.conf.json", import.meta.url);
const cargoTomlPath = new URL("../src-tauri/Cargo.toml", import.meta.url);
const cargoLockPath = new URL("../src-tauri/Cargo.lock", import.meta.url);

const [packageJson, packageLock, tauriConfig, cargoToml, cargoLock] = await Promise.all([
  readJson(packageJsonPath),
  readJson(packageLockPath),
  readJson(tauriConfigPath),
  readFile(cargoTomlPath, "utf8"),
  readFile(cargoLockPath, "utf8"),
]);

const isAlreadySet = packageJson.version === version && tauriConfig.version === version && cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] === version;

packageJson.version = version;
packageLock.version = version;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = version;
}
tauriConfig.version = version;
const nextCargoToml = cargoToml.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`);
const nextCargoLock = cargoLock.replace(
  /(\[\[package\]\]\r?\nname = "projects-runner-app"\r?\nversion = ")[^"]+"/,
  `$1${version}"`,
);

await Promise.all([
  writeJson(packageJsonPath, packageJson),
  writeJson(packageLockPath, packageLock),
  writeJson(tauriConfigPath, tauriConfig),
  writeFile(cargoTomlPath, nextCargoToml, "utf8"),
  writeFile(cargoLockPath, nextCargoLock, "utf8"),
]);

run(npmCommand, ["run", "release:check"]);

run("git", [
  "add",
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
]);

const staged = capture("git", ["diff", "--staged", "--name-only"]);
if (staged) {
  run("git", ["commit", "-m", `Release v${version}`]);
}

run("git", ["push", "origin", "master"]);
run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
run("git", ["push", "origin", tag]);

console.log(`Published release flow for version ${version} with tag ${tag}.`);
