import type { WhaleHoldingRowDto } from "@/lib/data/types";

type PositionsTableProps = {
  rows: WhaleHoldingRowDto[];
  highlightedTicker: string | null;
  onRegisterRowRef: (ticker: string, node: HTMLTableRowElement | null) => void;
};

function formatDollarThousands(valueUsdThousands: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(valueUsdThousands);
}

function formatShares(shares: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(shares);
}

function formatPrice(price: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(price);
}

function formatExpectedPrice(price: number | null): string {
  if (price === null) {
    return "N/A";
  }

  return formatPrice(price);
}

function parseGapPercent(gapLabel: string | null): number {
  if (!gapLabel) {
    return 0;
  }

  const parsed = Number.parseFloat(gapLabel.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function PositionsTable({ rows, highlightedTicker, onRegisterRowRef }: PositionsTableProps) {
  return (
    <div className="wi-position-table-shell">
      <table className="wi-position-table">
        <thead>
          <tr>
            <th title="상장 종목의 티커(symbol)">Ticker</th>
            <th title="전기 대비 변화 유형: NEW(신규), ADD(비중확대), REDUCE(비중축소), KEEP(유지)">Action</th>
            <th title="공시 원문 기준 보유가치(천 달러)">Value ($k)</th>
            <th title="공시 제출자가 보고한 절대 주식 수량">Shares</th>
            <th title="해당 공시 시점에서 운용사 포트폴리오 내 비중">Weight</th>
            <th title="이전 공시 원가 기준으로 추정한 기대 가격">Expected ($)</th>
            <th title="가격 괴리 계산에 사용한 현재 추정 가격">Current ($)</th>
            <th title="(현재 추정 가격 - 이전 추정 원가) / 이전 추정 원가">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className={row.ticker === highlightedTicker ? "positions-row row-highlight" : "positions-row"}
              data-testid={`positions-row-${row.ticker}`}
              data-ticker={row.ticker}
              data-type={row.type}
              key={row.ticker}
              ref={(node) => onRegisterRowRef(row.ticker, node)}
            >
              <td>
                <strong>{row.ticker}</strong>
                <p>{row.issuerName}</p>
              </td>
              <td>
                <span className={`wi-action-badge wi-action-badge--${row.type.toLowerCase()}`}>{row.type}</span>
              </td>
              <td>{formatDollarThousands(row.valueUsdThousands)}</td>
              <td>{formatShares(row.shares)}</td>
              <td>{row.weight}</td>
              <td>{formatExpectedPrice(row.cost)}</td>
              <td>{formatPrice(row.price)}</td>
              <td>
                <strong
                  className="wi-gap-number"
                  data-tone={row.gap ? (parseGapPercent(row.gap) < 0 ? "negative" : "positive") : "neutral"}
                >
                  {row.gap ?? "N/A"}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
