#!/usr/bin/env node

const DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321";

function resolveConfig() {
  const baseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    DEFAULT_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return {
    supabaseUrl: baseUrl.replace(/\/$/, ""),
    serviceRoleKey
  };
}

async function main() {
  const config = resolveConfig();

  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/refresh_whale_snapshot_tables`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to refresh whale snapshots: ${response.status} ${body}`);
  }

  const payload = await response.json();
  console.log("Whale snapshots refreshed:", payload);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[fatal]", message);
  process.exitCode = 1;
});
