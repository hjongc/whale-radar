import { type FilingAction } from "@/lib/domain/enums";
import type { WhaleHoldingRowDto } from "@/lib/data/types";

export type WhaleTableActionFilter = "ALL" | FilingAction;

const ACTION_LABELS: Record<FilingAction, string> = {
  NEW: "NEW(신규)",
  ADD: "ADD(비중확대)",
  REDUCE: "REDUCE(비중축소)",
  KEEP: "KEEP(유지)"
};

const ACTION_LABEL_TO_ENUM = new Map<string, FilingAction>([
  ["NEW", "NEW"],
  ["ADD", "ADD"],
  ["REDUCE", "REDUCE"],
  ["KEEP", "KEEP"],
  ["NEW (NEW)", "NEW"],
  ["ADD (ADD)", "ADD"],
  ["REDUCE (REDUCE)", "REDUCE"],
  ["KEEP (KEEP)", "KEEP"],
  [ACTION_LABELS.NEW.toUpperCase(), "NEW"],
  [ACTION_LABELS.ADD.toUpperCase(), "ADD"],
  [ACTION_LABELS.REDUCE.toUpperCase(), "REDUCE"],
  [ACTION_LABELS.KEEP.toUpperCase(), "KEEP"]
]);

export const WHALE_ACTION_FILTERS: WhaleTableActionFilter[] = ["ALL", "NEW", "ADD", "REDUCE", "KEEP"];

export function actionEnumToLabel(action: FilingAction): string {
  return ACTION_LABELS[action];
}

export function actionFilterToLabel(filter: WhaleTableActionFilter): string {
  if (filter === "ALL") {
    return "ALL(전체)";
  }

  return actionEnumToLabel(filter);
}

export function actionLabelToEnum(label: string): FilingAction | null {
  return ACTION_LABEL_TO_ENUM.get(label.trim().toUpperCase()) ?? null;
}

export function filterActionRows(rows: WhaleHoldingRowDto[], filter: WhaleTableActionFilter): WhaleHoldingRowDto[] {
  if (filter === "ALL") {
    return rows;
  }

  return rows.filter((row) => row.type === filter);
}
