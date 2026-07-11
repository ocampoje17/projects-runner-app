import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const srcTauriRoot = path.join(appRoot, "src-tauri");

const platform = process.argv[2];
const outputDirArg = process.argv[3];

if (!platform) {
  throw new Error("Usage: node ./scripts/prepare-release-artifacts.mjs <windows|linux|macos> [outputDir]");
}

const outputDir = outputDirArg
  ? path.resolve(appRoot, outputDirArg)
  : path.join(appRoot, "release-artifacts", platform);

const targets = {
  windows: [
    path.join(srcTauriRoot, "target", "release", "bundle", "nsis"),
  ],
  linux: [
    path.join(srcTauriRoot, "target", "release", "bundle", "appimage"),
    path.join(srcTauriRoot, "target", "release", "bundle", "deb"),
  ],
  macos: [
    path.join(srcTauriRoot, "target", "aarch64-apple-darwin", "release", "bundle", "dmg"),
  ],
};

const matchers = {
  windows: (name) => name.endsWith(".exe"),
  linux: (name) => name.endsWith(".AppImage") || name.endsWith(".deb"),
  macos: (name) => name.endsWith(".dmg"),
};

if (!(platform in targets)) {
  throw new Error(`Unsupported platform '${platform}'. Expected one of: ${Object.keys(targets).join(", ")}`);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const files = [];
for (const directory of targets[platform]) {
  try {
    const discovered = await walk(directory);
    files.push(...discovered.filter((file) => matchers[platform](path.basename(file))));
  } catch {
    // Ignore missing directories here; the final check below will fail with a clearer message.
  }
}

if (files.length === 0) {
  throw new Error(`No release artifacts found for platform '${platform}'.`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const file of files) {
  const destination = path.join(outputDir, path.basename(file));
  await cp(file, destination);
}

const packageJson = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const manifest = {
  platform,
  version: packageJson.version,
  files: files.map((file) => path.basename(file)).sort(),
};

const manifestPath = path.join(outputDir, "manifest.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Prepared ${files.length} artifact(s) for ${platform} in ${outputDir}`);
