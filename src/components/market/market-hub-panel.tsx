import { Panel, SectionHeader } from "@/components/layout/surface-primitives";
import type { MarketHubAggregateDto } from "@/lib/data";
import { useState } from "react";

export type MarketHubPanelState = "ready" | "loading" | "empty";

type MarketHubPanelProps = {
  marketData: MarketHubAggregateDto | null;
  state: MarketHubPanelState;
};

const GICS_11_SECTORS = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities"
] as const;

const GICS_COLOR_BY_SECTOR: Record<(typeof GICS_11_SECTORS)[number], string> = {
  "Communication Services": "#22d3ee",
  "Consumer Discretionary": "#10b981",
  "Consumer Staples": "#f59e0b",
  Energy: "#f97316",
  Financials: "#f43f5e",
  "Health Care": "#818cf8",
  Industrials: "#a3e635",
  "Information Technology": "#38bdf8",
  Materials: "#7dd3fc",
  "Real Estate": "#fda4af",
  Utilities: "#fde047"
};

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function hasMarketRows(marketData: MarketHubAggregateDto | null) {
  if (!marketData) {
    return false;
  }

  return (
    marketData.trackedInstitutions > 0 ||
    marketData.mostOwned.length > 0 ||
    marketData.hotSectorMovement.sector !== "N/A" ||
    marketData.sectorConcentration.length > 0
  );
}

function buildConcentrationRows(marketData: MarketHubAggregateDto | null) {
  if (!marketData) {
    return [] as Array<{ sector: string; value: number }>;
  }

  if (Array.isArray(marketData.sectorConcentration)) {
    return [...marketData.sectorConcentration]
      .map((row) => ({ sector: row.sector, value: row.weightPct }))
      .sort((a, b) => b.value - a.value);
  }

  return [];
}

function buildConcentrationDonut(rows: Array<{ sector: string; value: number }>) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  const rawBySector = new Map(rows.map((row) => [row.sector, Math.max(0, row.value)]));
  const gicsRows = GICS_11_SECTORS.map((sector) => ({
    sector,
    rawValue: rawBySector.get(sector) ?? 0
  }));
  const gicsTotal = gicsRows.reduce((sum, row) => sum + row.rawValue, 0);

  if (gicsTotal <= 0.001) {
    return {
      gradient: "conic-gradient(#3b4f71 0% 100%)",
      legend: gicsRows.map((row) => ({
        sector: row.sector,
        value: 0,
        color: GICS_COLOR_BY_SECTOR[row.sector]
      })),
      topCoveragePct: 0,
      gicsCoveragePct: 0
    };
  }

  const normalizedRows = gicsRows
    .map((row) => ({
      sector: row.sector,
      value: (row.rawValue / gicsTotal) * 100
    }))
    .sort((a, b) => b.value - a.value);
  const slices = normalizedRows.filter((row) => row.value > 0.001);

  let cursor = 0;
  const gradientParts = slices.map((slice) => {
    const start = cursor;
    const end = cursor + slice.value;
    cursor = end;
    const color = GICS_COLOR_BY_SECTOR[slice.sector];
    return `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });

  const legend = normalizedRows.map((slice) => ({
    ...slice,
    color: GICS_COLOR_BY_SECTOR[slice.sector]
  }));

  return {
    gradient: `conic-gradient(${gradientParts.join(", ")})`,
    legend,
    topCoveragePct: 100,
    gicsCoveragePct: total > 0 ? (gicsTotal / total) * 100 : 0
  };
}

function buildSectorNetChangeRows(flows: MarketHubAggregateDto["sectorRotation"]["flows"]) {
  const inflowBySector = new Map<string, number>();
  const outflowBySector = new Map<string, number>();

  for (const flow of flows) {
    outflowBySector.set(flow.fromSector, (outflowBySector.get(flow.fromSector) ?? 0) + flow.weightPct);
    inflowBySector.set(flow.toSector, (inflowBySector.get(flow.toSector) ?? 0) + flow.weightPct);
  }

  const sectors = new Set<string>([...inflowBySector.keys(), ...outflowBySector.keys()]);
  return [...sectors]
    .map((sector) => {
      const inflow = inflowBySector.get(sector) ?? 0;
      const outflow = outflowBySector.get(sector) ?? 0;
      return {
        sector,
        inflow,
        outflow,
        netChange: inflow - outflow
      };
    })
    .sort((a, b) => b.netChange - a.netChange);
}

function SectorRotationMap({
  flows,
  updatedQuarter
}: {
  flows: MarketHubAggregateDto["sectorRotation"]["flows"];
  updatedQuarter: string;
}) {
  if (flows.length === 0) {
    return <p className="wi-chart-placeholder">섹터 로테이션 데이터가 아직 없습니다. 집계 갱신 후 다시 확인하세요.</p>;
  }

  const netChangeRows = buildSectorNetChangeRows(flows);
  const maxSideFlow = Math.max(
    ...netChangeRows.flatMap((row) => [row.inflow, row.outflow]),
    1
  );
  const totalInflow = netChangeRows.reduce((sum, row) => sum + row.inflow, 0);
  const totalOutflow = netChangeRows.reduce((sum, row) => sum + row.outflow, 0);
  const totalNet = netChangeRows.reduce((sum, row) => sum + row.netChange, 0);
  const inflowBreadth = netChangeRows.filter((row) => row.netChange > 0.01).length;
  const outflowBreadth = netChangeRows.filter((row) => row.netChange < -0.01).length;
  const topNetIn = [...netChangeRows].sort((a, b) => b.netChange - a.netChange).at(0);
  const topNetOut = [...netChangeRows].sort((a, b) => a.netChange - b.netChange).at(0);

  return (
    <div className="wi-rotation-stack">
      <div className="wi-rotation-meta">
        <span>분기 스냅샷 기준으로 섹터별 유입/유출과 순변화를 추정합니다.</span>
        <strong>{`${updatedQuarter} 최종 공시`}</strong>
      </div>

      <section className="wi-rotation-block" data-testid="sector-rotation-heatmap">
        <p className="wi-rotation-title">섹터 수급 편차</p>
        <div className="wi-rotation-diverging">
          {netChangeRows.map((row) => {
            const outflowWidth = Math.max(4, (row.outflow / maxSideFlow) * 100);
            const inflowWidth = Math.max(4, (row.inflow / maxSideFlow) * 100);

            return (
              <article className="wi-rotation-diverging-row" key={`row-${row.sector}`}>
                <div className="wi-rotation-diverging-meta">
                  <p>{row.sector}</p>
                  <span>{formatSignedPercent(row.netChange)} 순변화</span>
                </div>
                <div className="wi-rotation-diverging-track" aria-hidden="true">
                  <div className="wi-rotation-diverging-half wi-rotation-diverging-half--left">
                    <i className="wi-rotation-bar wi-rotation-bar--out" style={{ width: `${outflowWidth}%` }} />
                  </div>
                  <div className="wi-rotation-diverging-axis" />
                  <div className="wi-rotation-diverging-half wi-rotation-diverging-half--right">
                    <i className="wi-rotation-bar wi-rotation-bar--in" style={{ width: `${inflowWidth}%` }} />
                  </div>
                </div>
                <div className="wi-rotation-diverging-legend">
                  <span>유출 {row.outflow.toFixed(2)}%</span>
                  <span>유입 {row.inflow.toFixed(2)}%</span>
                </div>
              </article>
            );
          })}
        </div>
        <div className="wi-rotation-diverging-summary">
          <span>{`유입/유출 브레드스 ${inflowBreadth}/${outflowBreadth}`}</span>
          <span>{`순유입 상위 ${topNetIn?.sector ?? "N/A"}`}</span>
          <span>{`순유출 상위 ${topNetOut?.sector ?? "N/A"}`}</span>
          <span>총 유출 {totalOutflow.toFixed(2)}%</span>
          <span>총 유입 {totalInflow.toFixed(2)}%</span>
          <strong>{formatSignedPercent(totalNet)} 순변화</strong>
        </div>
      </section>
    </div>
  );
}

export function MarketHubPanel({ marketData, state }: MarketHubPanelProps) {
  const [donutHover, setDonutHover] = useState<{ sector: string; value: number } | null>(null);
  const showLoading = state === "loading";
  const hasData = hasMarketRows(marketData);
  const showEmpty = !showLoading && !hasData;

  const concentrationRows = buildConcentrationRows(marketData);
  const concentrationDonut = buildConcentrationDonut(concentrationRows);
  const hasGapCandidate = Boolean(marketData?.highestMarginOfSafety.ticker && marketData.highestMarginOfSafety.ticker !== "N/A");

  const handleDonutHover = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!concentrationDonut.legend.length) {
      setDonutHover(null);
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const radians = Math.atan2(y - centerY, x - centerX);
    const angleDeg = (radians * 180) / Math.PI;
    const normalizedDeg = (angleDeg + 450) % 360;
    const percentage = (normalizedDeg / 360) * 100;

    let cursor = 0;
    for (const slice of concentrationDonut.legend) {
      const start = cursor;
      const end = cursor + slice.value;
      cursor = end;

      if (percentage >= start && percentage < end) {
        setDonutHover({ sector: slice.sector, value: slice.value });
        return;
      }
    }

    setDonutHover(null);
  };

  return (
    <>
      <SectionHeader
        subtitle="서버 집계 DTO를 기반으로 핵심 지표와 섹터 흐름을 실시간으로 보여줍니다."
        title="마켓 허브"
      />

      <div className="wi-grid-three">
        <article className="wi-card wi-card--cyan wi-kpi-card kpi-card" data-state={state}>
          <p className="wi-kicker">커버리지 펄스</p>
          <p className="wi-card-headline">최다 보유 종목</p>
          {showLoading ? (
            <div aria-busy="true" className="wi-kpi-skeleton panel-skeleton" data-testid="loading-placeholder">
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
            </div>
          ) : showEmpty ? (
            <p className="wi-empty-copy">보유 집계 데이터를 기다리는 중입니다.</p>
          ) : (
            <>
              <p className="wi-kpi-subcopy">
                총 {marketData?.trackedInstitutions ?? 0}개 기관을 추적해 교차 운용사 시그널을 제공합니다.
              </p>
              <ul className="wi-kpi-list">
                {(marketData?.mostOwned ?? []).map((entry) => (
                  <li key={entry.ticker}>
                    <span>{entry.ticker}</span>
                    <strong>{entry.institutionCount}개 기관</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>

        <article className="wi-card wi-card--mint wi-kpi-card kpi-card" data-state={state}>
          <p className="wi-kicker">트렌드 시그널</p>
          <p className="wi-card-headline">핫 섹터</p>
          {showLoading ? (
            <div aria-busy="true" className="wi-kpi-skeleton panel-skeleton" data-testid="loading-placeholder">
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
            </div>
          ) : showEmpty ? (
            <p className="wi-empty-copy">섹터 수급 데이터가 아직 없습니다.</p>
          ) : (
            <div className="wi-kpi-focus">
              <strong>{marketData?.hotSectorMovement.sector}</strong>
              <p>{formatSignedPercent(marketData?.hotSectorMovement.deltaWeightPct ?? 0)} 분기 수급 변화</p>
              <span>{marketData?.hotSectorMovement.summary}</span>
            </div>
          )}
        </article>

        <article className="wi-card wi-card--sunset wi-kpi-card kpi-card" data-state={state}>
          <p className="wi-kicker">갭 트래커</p>
          <p className="wi-card-headline">최대 가격 괴리</p>
          {showLoading ? (
            <div aria-busy="true" className="wi-kpi-skeleton panel-skeleton" data-testid="loading-placeholder">
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
            </div>
          ) : showEmpty ? (
            <p className="wi-empty-copy">갭 랭킹은 보강 데이터 반영을 기다리고 있습니다.</p>
          ) : (
            <div className="wi-kpi-focus">
              <strong>{marketData?.highestMarginOfSafety.ticker}</strong>
              <p>{hasGapCandidate ? `${formatSignedPercent(marketData?.highestMarginOfSafety.gapPct ?? 0)} 추정 기준가 대비 괴리율` : "신뢰 가능한 괴리 후보가 아직 없습니다"}</p>
            </div>
          )}
        </article>
      </div>

      <div className="wi-grid-two wi-grid-two--charts">
        <Panel className="wi-chart-panel sector-rotation-chart">
          <SectionHeader
            compact
            subtitle={`분기 기준: ${marketData?.sectorRotation.updatedQuarter ?? "미공개"}`}
            title="섹터 로테이션"
          />
          {showLoading ? (
            <div aria-busy="true" className="wi-chart-loading panel-skeleton" data-testid="loading-placeholder">
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
            </div>
          ) : showEmpty ? (
            <p className="wi-chart-placeholder">섹터 로테이션 데이터가 아직 없습니다. 집계 갱신 후 다시 확인하세요.</p>
          ) : (
            <SectorRotationMap
              flows={marketData?.sectorRotation.flows ?? []}
              updatedQuarter={marketData?.sectorRotation.updatedQuarter ?? "미공개"}
            />
          )}
        </Panel>

        <Panel className="wi-chart-panel sector-concentration-chart">
          <SectionHeader compact subtitle="GICS 11개 섹터만 정규화해 100% 기준으로 표시합니다." title="섹터 집중도" />
          {showLoading ? (
            <div aria-busy="true" className="wi-chart-loading panel-skeleton" data-testid="loading-placeholder">
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
              <span className="wi-skeleton-line" />
            </div>
          ) : showEmpty ? (
            <p className="wi-chart-placeholder">이번 분기 섹터 집중도 스냅샷이 없습니다.</p>
          ) : concentrationRows.length === 0 ? (
            <p className="wi-chart-placeholder">집중도 캐시를 갱신 중입니다. 잠시 후 다시 시도하세요.</p>
          ) : (
            <div className="wi-concentration-donut-layout">
              <button
                type="button"
                className="wi-concentration-donut"
                style={{ backgroundImage: concentrationDonut.gradient }}
                onMouseMove={handleDonutHover}
                onMouseLeave={() => setDonutHover(null)}
                title={donutHover ? `${donutHover.sector}: ${donutHover.value.toFixed(2)}%` : "마우스를 올려 섹터 비중을 확인하세요"}
              >
                <div className="wi-concentration-donut-hole">
                  <span>{donutHover ? donutHover.sector : "GICS 11"}</span>
                  <strong>{donutHover ? `${donutHover.value.toFixed(2)}%` : `${concentrationDonut.topCoveragePct.toFixed(1)}%`}</strong>
                </div>
              </button>

              <div className="wi-concentration-spans">
                {concentrationDonut.legend.map((row) => (
                  <span className="wi-concentration-chip" key={row.sector} title={`${row.sector}: ${row.value.toFixed(2)}%`}>
                    <i style={{ backgroundColor: row.color }} />
                    <em>{row.sector}</em>
                    <strong>{row.value.toFixed(2)}%</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
          {!showLoading && !showEmpty && concentrationRows.length > 0 ? (
            <p className="wi-concentration-note">{`총 보유가치 대비 ${concentrationDonut.gicsCoveragePct.toFixed(1)}% 커버리지 (비GICS/ETF/SPAC/미분류 제외)`}</p>
          ) : null}
        </Panel>
      </div>
    </>
  );
}
