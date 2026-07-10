#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const targets = [
  { local: "src/components/motion/action-swap.tsx", remote: "https://raw.githubusercontent.com/starc007/ui-components/main/components/motion/action-swap.tsx" },
  { local: "src/components/motion/animated-toast-stack.tsx", remote: "https://raw.githubusercontent.com/starc007/ui-components/main/components/motion/animated-toast-stack.tsx" },
  { local: "src/components/motion/tooltip.tsx", remote: "https://raw.githubusercontent.com/starc007/ui-components/main/components/motion/tooltip.tsx" },
  { local: "src/lib/ease.ts", remote: "https://raw.githubusercontent.com/starc007/ui-components/main/lib/ease.ts" },
  { local: "src/lib/utils.ts", remote: "https://raw.githubusercontent.com/starc007/ui-components/main/lib/utils.ts" },
];

function sha(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
function normalize(text) {
  return text.replace(/\r\n/g, "\n").trim() + "\n";
}
function printLine(file, status, detail) {
  console.log(`${status.padEnd(12)} ${file}${detail ? `  ${detail}` : ""}`);
}

const rows = [];
for (const target of targets) {
  const localPath = path.join(root, target.local);
  if (!existsSync(localPath)) {
    rows.push({ file: target.local, status: "missing-local" });
    continue;
  }
  const local = normalize(readFileSync(localPath, "utf8"));
  try {
    const res = await fetch(target.remote, { headers: { "User-Agent": "projects-runner-beui-sync" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remoteText = normalize(await res.text());
    const same = local === remoteText;
    rows.push({
      file: target.local,
      status: same ? "in-sync" : "diverged",
      local: sha(local),
      remote: sha(remoteText),
      localBytes: local.length,
      remoteBytes: remoteText.length,
    });
  } catch (error) {
    rows.push({ file: target.local, status: `remote-error: ${error.message}` });
  }
}

console.log("beUI sync check\n");
for (const row of rows) {
  if (row.status === "in-sync") printLine(row.file, "IN SYNC", row.local);
  else if (row.status === "diverged") printLine(row.file, "DIVERGED", `${row.local} -> ${row.remote} (${row.localBytes}/${row.remoteBytes} bytes)`);
  else printLine(row.file, row.status.toUpperCase(), "");
}
const issues = rows.filter((r) => r.status !== "in-sync");
console.log(issues.length ? `\n${issues.length} file(s) need review. Adapted forks are expected.` : "\nAll tracked sources match upstream.");
