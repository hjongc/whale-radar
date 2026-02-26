import type { WhaleGapRankingItemDto } from "@/lib/data/types";

type GapFinderChartProps = {
  rankings: WhaleGapRankingItemDto[];
  activeTicker: string | null;
  onSelectTicker: (ticker: string) => void;
};

function parseGapPercent(gapLabel: string): number {
  const parsed = Number.parseFloat(gapLabel.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function GapFinderChart({ rankings, activeTicker, onSelectTicker }: GapFinderChartProps) {
  if (rankings.length === 0) {
    return <p className="wi-chart-placeholder">No gap ranking data available for this manager.</p>;
  }

  const maxGapMagnitude = Math.max(...rankings.map((item) => Math.abs(parseGapPercent(item.gap))), 1);
  const negativeRankings = rankings
    .filter((item) => parseGapPercent(item.gap) < 0)
    .sort((a, b) => parseGapPercent(a.gap) - parseGapPercent(b.gap))
    .slice(0, 20);
  const positiveRankings = [...rankings]
    .filter((item) => parseGapPercent(item.gap) >= 0)
    .sort((a, b) => parseGapPercent(b.gap) - parseGapPercent(a.gap))
    .slice(0, 20);

  const renderGapList = (items: WhaleGapRankingItemDto[], emptyMessage: string) => {
    if (items.length === 0) {
      return <p className="wi-chart-placeholder wi-gap-empty">{emptyMessage}</p>;
    }

    return items.map((item) => {
      const gapValue = parseGapPercent(item.gap);
      const width = Math.max((Math.abs(gapValue) / maxGapMagnitude) * 100, 10);

      return (
        <button
          aria-label={`Highlight ${item.ticker} row`}
          className="wi-gap-bar gap-finder-bar"
          data-active={activeTicker === item.ticker}
          data-testid={`gap-bar-${item.ticker}`}
          data-ticker={item.ticker}
          key={item.ticker}
          onClick={() => onSelectTicker(item.ticker)}
          type="button"
        >
          <span className="wi-gap-ticker">{item.ticker}</span>
          <span className="wi-gap-track">
            <i
              className="wi-gap-fill"
              data-direction={gapValue < 0 ? "negative" : "positive"}
              style={{ width: `${width}%` }}
            />
          </span>
          <span className="wi-gap-value" data-tone={gapValue < 0 ? "negative" : "positive"}>
            {item.gap}
          </span>
        </button>
      );
    });
  };

  return (
    <div className="wi-gap-chart gap-finder-chart" data-testid="gap-finder-chart">
      <p className="wi-coupling-status wi-coupling-note">
        Gap 해석 가이드: 음수(-)는 현재 가격이 직전 분기 추정 매입단가보다 낮은 상태, 양수(+)는 더 높은 상태입니다.
      </p>
      <section className="wi-gap-column" data-direction="negative">
        <h4>Negative Gap Top 20 (할인 구간 후보)</h4>
        <div className="wi-gap-column-list">{renderGapList(negativeRankings, "No negative gaps in this filing set.")}</div>
      </section>
      <section className="wi-gap-column" data-direction="positive">
        <h4>Positive Gap Top 20 (프리미엄 구간)</h4>
        <div className="wi-gap-column-list">{renderGapList(positiveRankings, "No positive gaps in this filing set.")}</div>
      </section>
    </div>
  );
}
