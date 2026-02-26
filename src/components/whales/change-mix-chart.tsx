import type { WhaleActionMixItemDto } from "@/lib/data/types";

import { actionEnumToLabel, actionLabelToEnum } from "@/components/whales/interaction-state";

type ChangeMixChartProps = {
  actionMix: WhaleActionMixItemDto[];
  activeAction: "ALL" | "NEW" | "ADD" | "REDUCE" | "KEEP";
  onSelectLabel: (label: string) => void;
};

type ChartSegment = {
  action: "NEW" | "ADD" | "REDUCE" | "KEEP" | null;
  label: string;
  count: number;
};

function buildSegments(actionMix: WhaleActionMixItemDto[]): ChartSegment[] {
  return actionMix.map((item) => {
    const mappedAction = actionLabelToEnum(String(item.type));

    if (!mappedAction) {
      return {
        action: null,
        label: `Unsupported (${String(item.type)})`,
        count: item.count
      };
    }

    return {
      action: mappedAction,
      label: actionEnumToLabel(mappedAction),
      count: item.count
    };
  });
}

export function ChangeMixChart({ actionMix, activeAction, onSelectLabel }: ChangeMixChartProps) {
  const segments = buildSegments(actionMix);

  if (segments.length === 0) {
    return <p className="wi-chart-placeholder">No action mix data available for this manager.</p>;
  }

  const totalCount = Math.max(
    segments.reduce((sum, segment) => sum + Math.max(segment.count, 0), 0),
    1
  );

  return (
    <div className="wi-change-mix change-mix-chart" data-testid="change-mix-chart">
      {segments.map((segment) => {
        const share = (Math.max(segment.count, 0) / totalCount) * 100;
        const segmentAction = segment.action ?? "UNKNOWN";

        return (
          <button
            aria-label={`Filter table with ${segment.label}`}
            className="wi-change-segment change-mix-segment"
            data-action={segmentAction}
            data-testid={`change-mix-segment-${segmentAction}`}
            data-tone={segmentAction}
            key={`${segmentAction}-${segment.label}`}
            onClick={() => onSelectLabel(segment.label)}
            type="button"
          >
            <span>{segment.label}</span>
            <strong>{segment.count}</strong>
            <i
              data-active={segment.action ? activeAction === segment.action : false}
              style={{ width: `${Math.max(share, 6)}%` }}
            />
          </button>
        );
      })}
    </div>
  );
}
