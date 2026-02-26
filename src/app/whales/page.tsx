import { DashboardShell } from "@/components/layout/dashboard-shell";
import { getCachedMarketHubAggregates } from "@/lib/data";

type WhalesPageProps = {
  searchParams?: {
    whale?: string;
  };
};

export default async function WhalesPage({ searchParams }: WhalesPageProps) {
  const marketData = await getCachedMarketHubAggregates();

  return <DashboardShell initialTab="whale" initialWhale={searchParams?.whale} marketData={marketData} />;
}
