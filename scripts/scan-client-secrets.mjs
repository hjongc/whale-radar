import fs from "node:fs";
import path from "node:path";

const targetDir = path.resolve(".next/static");
const blockedTokens = [
  "CRON_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_ACCESS_TOKEN",
  "POSTGRES_PASSWORD"
];

function walkFiles(dir, collected = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, collected);
    } else {
      collected.push(fullPath);
    }
  }
  return collected;
}

if (!fs.existsSync(targetDir)) {
  console.error(`[secret-scan] Missing build output directory: ${targetDir}`);
  console.error("[secret-scan] Run `npm run build` before scanning client assets.");
  process.exit(1);
}

const allFiles = walkFiles(targetDir);
const candidateFiles = allFiles.filter((filePath) => /\.(js|css|map|txt)$/.test(filePath));
const leaks = [];

for (const filePath of candidateFiles) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const token of blockedTokens) {
    if (content.includes(token)) {
      leaks.push(`${token} -> ${path.relative(process.cwd(), filePath)}`);
    }
  }
}

console.log(`[secret-scan] scanned-files=${candidateFiles.length}`);
console.log(`[secret-scan] blocked-tokens=${blockedTokens.join(",")}`);

if (leaks.length > 0) {
  console.error("[secret-scan] FAIL: blocked token(s) found in client assets");
  for (const leak of leaks) {
    console.error(`[secret-scan] ${leak}`);
  }
  process.exit(1);
}

console.log("[secret-scan] PASS: no blocked tokens found in client assets");
