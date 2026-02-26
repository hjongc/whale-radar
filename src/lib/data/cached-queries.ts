import { unstable_cache } from "next/cache";

import { DASHBOARD_CACHE_TAGS, whaleManagerTag } from "@/lib/cache";
import {
  queryMarketHubAggregates,
  queryWhaleInsiderManagerBase,
  queryWhaleManagerDirectory,
  toWhaleInsiderDto
} from "@/lib/data/aggregate-queries";
import type { WhaleHoldingsQueryParams } from "@/lib/data/types";

const MARKET_CACHE_KEY = "dashboard-market-hub-v6";
const MARKET_REVALIDATE_SECONDS = 300;
const WHALE_REVALIDATE_SECONDS = 300;
const WHALE_DIRECTORY_REVALIDATE_SECONDS = 300;

function assertNonEmptyWhaleDirectory<T>(directory: T[]): T[] {
  if (directory.length === 0) {
    throw new Error("Whale manager directory is empty.");
  }

  return directory;
}

function isUnstableCacheUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.includes("incrementalCache missing in unstable_cache");
}

const getCachedMarketHubAggregatesInternal = unstable_cache(
  async () => queryMarketHubAggregates(),
  [MARKET_CACHE_KEY],
  {
    revalidate: MARKET_REVALIDATE_SECONDS,
    tags: [DASHBOARD_CACHE_TAGS.market]
  }
);

const WHALE_MANAGER_BASE_CACHE_PREFIX = "dashboard-whale-insider-base-v2";

export async function getCachedMarketHubAggregates() {
  try {
    return await getCachedMarketHubAggregatesInternal();
  } catch (error) {
    if (!isUnstableCacheUnavailable(error)) {
      throw error;
    }

    return queryMarketHubAggregates();
  }
}

export async function getCachedWhaleInsiderAggregates(query: WhaleHoldingsQueryParams) {
  const getCachedWhaleManagerBase = unstable_cache(
    async () => queryWhaleInsiderManagerBase(query.managerId),
    [WHALE_MANAGER_BASE_CACHE_PREFIX, query.managerId],
    {
      revalidate: WHALE_REVALIDATE_SECONDS,
      tags: [DASHBOARD_CACHE_TAGS.whales, whaleManagerTag(query.managerId)]
    }
  );

  try {
    const base = await getCachedWhaleManagerBase();
    return toWhaleInsiderDto(base, query);
  } catch (error) {
    if (!isUnstableCacheUnavailable(error)) {
      throw error;
    }

    const base = await queryWhaleInsiderManagerBase(query.managerId);
    return toWhaleInsiderDto(base, query);
  }
}

const getCachedWhaleManagerDirectoryInternal = unstable_cache(
  async () => assertNonEmptyWhaleDirectory(await queryWhaleManagerDirectory()),
  ["dashboard-whale-directory-v3"],
  {
    revalidate: WHALE_DIRECTORY_REVALIDATE_SECONDS,
    tags: [DASHBOARD_CACHE_TAGS.whales]
  }
);

export async function getCachedWhaleManagerDirectory() {
  try {
    return await getCachedWhaleManagerDirectoryInternal();
  } catch (error) {
    if (!isUnstableCacheUnavailable(error)) {
      throw error;
    }

    return assertNonEmptyWhaleDirectory(await queryWhaleManagerDirectory());
  }
}
