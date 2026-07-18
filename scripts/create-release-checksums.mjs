import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), process.argv[2] ?? "release-artifacts");
const output = path.join(root, "SHA256SUMS.txt");
const supportedExtensions = new Set([".exe", ".AppImage", ".deb", ".dmg"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(file));
    } else if (supportedExtensions.has(path.extname(entry.name))) {
      files.push(file);
    }
  }
  return files;
}

const files = (await walk(root)).sort((left, right) => left.localeCompare(right));
if (files.length === 0) {
  throw new Error("No release installers found to checksum.");
}

const lines = await Promise.all(files.map(async (file) => {
  const hash = createHash("sha256").update(await readFile(file)).digest("hex");
  return `${hash}  ${path.basename(file)}`;
}));

await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(`Created ${output} for ${files.length} release asset(s).`);
