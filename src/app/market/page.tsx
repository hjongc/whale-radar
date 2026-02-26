import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCachedMarketHubAggregates } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function MarketHubPage() {
  const marketData = await getCachedMarketHubAggregates();
  return <DashboardShell initialTab="market" marketData={marketData} />;
}
