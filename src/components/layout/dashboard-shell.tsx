"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MarketHubPanel, type MarketHubPanelState } from "@/components/market/market-hub-panel";
import { WhaleInsiderPanel } from "@/components/whales/whale-insider-panel";
import type { MarketHubAggregateDto } from "@/lib/data";

type TabId = "market" | "whale";

type TabConfig = {
  id: TabId;
  title: string;
  blurb: string;
};

const tabs: TabConfig[] = [
  {
    id: "market",
    title: "마켓 허브",
    blurb: "기관 수급 흐름과 섹터 집중도를 한눈에 확인합니다"
  },
  {
    id: "whale",
    title: "운용사 동향",
    blurb: "대형 운용사의 분기별 보유 종목 변화를 추적합니다"
  }
];

type DashboardShellProps = {
  initialTab?: TabId;
  marketData?: MarketHubAggregateDto | null;
  marketState?: MarketHubPanelState;
  initialWhale?: string;
};

function hasMarketData(marketData: MarketHubAggregateDto | null | undefined) {
  if (!marketData) {
    return false;
  }

  return (
    marketData.mostOwned.length > 0 ||
    marketData.sectorRotation.flows.length > 0 ||
    marketData.cashTrend.series.length > 0
  );
}

export function DashboardShell({
  initialTab = "market",
  marketData = null,
  marketState,
  initialWhale
}: DashboardShellProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab: TabId = pathname.startsWith("/whales") ? "whale" : initialTab;
  const resolvedMarketState: MarketHubPanelState =
    marketState ?? (hasMarketData(marketData) ? "ready" : "empty");

  const tabSummary = useMemo(
    () => tabs.find((tab) => tab.id === activeTab)?.blurb ?? "",
    [activeTab]
  );

  const handleTabClick = (tabId: TabId) => {
    if (tabId === "market") {
      router.push("/market");
      return;
    }

    const whale = searchParams.get("whale");
    router.push(whale ? `/whales?whale=${encodeURIComponent(whale)}` : "/whales");
  };

  return (
    <main className="wi-shell" data-testid="dashboard-shell">
      <header className="wi-topbar">
        <div>
          <p className="wi-eyebrow">Whale Radar</p>
          <h1 className="wi-page-title" data-testid="dashboard-shell-title">
            기관 보유공시 분석 대시보드
          </h1>
          <p className="wi-page-subtitle">미국 기관 보유공시(13F) 기반으로 운용사 포지션과 시장 수급 흐름을 빠르게 점검합니다.</p>
        </div>
        <nav aria-label="대시보드 탭" className="tab-nav wi-tab-nav" data-testid="dashboard-tab-nav">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                aria-controls={`section-${tab.id}`}
                aria-pressed={isActive}
                className="wi-tab-button"
                data-active={isActive}
                onClick={() => handleTabClick(tab.id)}
                type="button"
              >
                {tab.title}
              </button>
            );
          })}
        </nav>
      </header>

      <p className="wi-tab-summary">{tabSummary}</p>

      <div className="wi-content-stack">
        <section className={activeTab === "market" ? "wi-tab-panel" : "wi-tab-panel is-hidden"} id="section-market">
          <MarketHubPanel marketData={marketData} state={resolvedMarketState} />
        </section>

        <section className={activeTab === "whale" ? "wi-tab-panel" : "wi-tab-panel is-hidden"} id="section-whale">
          {activeTab === "whale" ? <WhaleInsiderPanel initialWhaleSlug={initialWhale} /> : null}
        </section>
      </div>
    </main>
  );
}
