import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { queryMarketHubAggregates } from "@/lib/data";
import { seedAggregateSource } from "@/lib/data/mock-source";

describe("Market Hub panel", () => {
  it("renders KPI values from server aggregate DTO", async () => {
    const dto = await queryMarketHubAggregates(seedAggregateSource);

    render(<DashboardShell marketData={dto} />);

    expect(screen.getByText("최다 보유 종목")).toBeInTheDocument();
    expect(
      screen.getByText(`총 ${dto.trackedInstitutions}개 기관을 추적해 교차 운용사 시그널을 제공합니다.`)
    ).toBeInTheDocument();
    for (const entry of dto.mostOwned.slice(0, 2)) {
      expect(screen.getByText(entry.ticker)).toBeInTheDocument();
      expect(screen.getByText(`${entry.institutionCount}개 기관`)).toBeInTheDocument();
    }
    expect(screen.getByText("핫 섹터")).toBeInTheDocument();
    expect(screen.getByText("최대 가격 괴리")).toBeInTheDocument();
  });

  it("renders explicit empty placeholders when aggregate rows are unavailable", () => {
    render(<DashboardShell marketData={null} marketState="empty" />);

    expect(screen.getByText("보유 집계 데이터를 기다리는 중입니다.")).toBeInTheDocument();
    expect(screen.getByText("섹터 로테이션 데이터가 아직 없습니다. 집계 갱신 후 다시 확인하세요.")).toBeInTheDocument();
    expect(screen.getByText("이번 분기 섹터 집중도 스냅샷이 없습니다.")).toBeInTheDocument();
  });

  it("renders loading placeholders for KPI cards and chart containers", () => {
    render(<DashboardShell marketData={null} marketState="loading" />);

    expect(screen.getAllByTestId("loading-placeholder")).toHaveLength(5);
  });
});
