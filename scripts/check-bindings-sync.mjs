import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const tempDir = path.join(rootDir, ".tmp_bindings_check");
const actualDir = path.join(rootDir, "src", "types", "generated");

try {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("Generating TypeScript bindings into temporary directory...");
  execSync(
    `cargo run --manifest-path src-tauri/Cargo.toml --bin export_bindings -- "${tempDir}"`,
    { cwd: rootDir, stdio: "inherit" },
  );

  const files = ["twofa.ts", "terminal.ts", "sync.ts"];
  let hasMismatch = false;

  for (const file of files) {
    const tempFile = path.join(tempDir, file);
    const actualFile = path.join(actualDir, file);

    if (!fs.existsSync(tempFile)) {
      console.error(`Error: Temporary binding file missing: ${file}`);
      hasMismatch = true;
      continue;
    }

    if (!fs.existsSync(actualFile)) {
      console.error(`Error: Actual binding file missing: ${file}`);
      hasMismatch = true;
      continue;
    }

    const tempContent = fs.readFileSync(tempFile, "utf-8").replace(/\r\n/g, "\n");
    const actualContent = fs.readFileSync(actualFile, "utf-8").replace(/\r\n/g, "\n");

    if (tempContent !== actualContent) {
      console.error(`Error: Binding mismatch in ${file}! Run 'npm run bindings' to update.`);
      hasMismatch = true;
    }
  }

  if (hasMismatch) {
    process.exit(1);
  }

  console.log("TypeScript bindings are up to date!");
} finally {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
