import { revalidateTag } from "next/cache";

import type { OpsTarget } from "@/lib/ops/types";
import { DASHBOARD_CACHE_TAGS } from "@/lib/cache/tags";

const REVALIDATION_TAGS_BY_TARGET: Record<OpsTarget, string[]> = {
  discovery: [DASHBOARD_CACHE_TAGS.market, DASHBOARD_CACHE_TAGS.whales],
  ingest: [DASHBOARD_CACHE_TAGS.market, DASHBOARD_CACHE_TAGS.whales],
  enrichment: [DASHBOARD_CACHE_TAGS.market, DASHBOARD_CACHE_TAGS.whales]
};

export function revalidateDashboardCaches(target: OpsTarget) {
  for (const tag of REVALIDATION_TAGS_BY_TARGET[target]) {
    revalidateTag(tag);
  }
}
