import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(
  /^host: (.+)$/m,
)?.[1];
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || host;
if (!target) throw new Error("Unable to determine the Rust target triple.");
const debug =
  process.argv.includes("--debug") || process.env.TAURI_ENV_DEBUG === "true";
const args = [
  "build",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--bin",
  "projects-runner-mcp",
];
if (target !== host) args.push("--target", target);
if (!debug) args.push("--release");
const env = { ...process.env };
delete env.TAURI_CONFIG;
if (!env.CARGO_BUILD_TARGET) delete env.CARGO_BUILD_TARGET;
execFileSync("cargo", args, { cwd: root, env, stdio: "inherit" });
const suffix = target.includes("windows") ? ".exe" : "";
const binaries = path.join(root, "src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });
const source = path.join(
  process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri", "target"),
  ...(target === host && !env.CARGO_BUILD_TARGET ? [] : [target]),
  debug ? "debug" : "release",
  `projects-runner-mcp${suffix}`,
);
copyFileSync(
  source,
  path.join(binaries, `projects-runner-mcp-${target}${suffix}`),
);
console.log(`MCP bridge ready: ${target}`);
