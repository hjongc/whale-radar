type LineageBadgeData = {
  accession?: string;
  priceTimestamp?: string;
  calcVersion?: string;
  source?: string;
  freshness?: "fresh" | "stale";
  staleReason?: string;
};

type LineageBadgesProps = {
  lineage: LineageBadgeData;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

export function hasCompleteLineage(lineage: LineageBadgeData): boolean {
  return Boolean(
    lineage.accession && lineage.priceTimestamp && lineage.calcVersion && lineage.source && lineage.freshness
  );
}

export function LineageBadges({ lineage }: LineageBadgesProps) {
  if (!hasCompleteLineage(lineage)) {
    return <span className="lineage-warning">Lineage unavailable: missing provenance metadata.</span>;
  }

  const priceTimestamp = lineage.priceTimestamp ?? "";

  return (
    <span className="lineage-badge-row">
      <span className="lineage-badge" data-tone={lineage.freshness}>
        {lineage.freshness}
      </span>
      <span className="lineage-badge" data-tone="source">
        {lineage.source}
      </span>
      <span className="lineage-badge" data-tone="timestamp">
        {formatTimestamp(priceTimestamp)}
      </span>
    </span>
  );
}
