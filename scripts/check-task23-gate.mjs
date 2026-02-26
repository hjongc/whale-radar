import { readFileSync } from "node:fs";

const gatePath = new URL("../.sisyphus/state/task23-complete.json", import.meta.url);

function fail(message) {
  console.error(message);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(readFileSync(gatePath, "utf8"));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown read error";
  fail(`Task23 gate file is missing or invalid JSON: ${message}`);
}

const completed = payload?.completed === true;
const source = typeof payload?.source === "string" ? payload.source : "unknown";
const checkedAt = typeof payload?.checked_at === "string" ? payload.checked_at : "unknown";

if (!completed) {
  fail(`Task23 gate is BLOCKED (completed=false). source=${source} checked_at=${checkedAt}`);
}

console.log(`Task23 gate is OPEN (completed=true). source=${source} checked_at=${checkedAt}`);
