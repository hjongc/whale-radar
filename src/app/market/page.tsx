import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCachedMarketHubAggregates } from "@/lib/data";

export default async function MarketHubPage() {
  const marketData = await getCachedMarketHubAggregates();
  return <DashboardShell initialTab="market" marketData={marketData} />;
}
