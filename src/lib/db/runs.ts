import type { RunErrorPayload } from "@/lib/domain/contracts";
import type { RunKind, RunStatus } from "@/lib/domain/enums";
import { parseRunErrorPayload } from "@/lib/domain/validation";

export type RunLedgerRowCounts = Record<string, number>;

export interface RunLedgerRecord {
  runId: string;
  runKind: RunKind;
  runStatus: RunStatus;
  triggerMode: string;
  requestSignature: string;
  targetAccessionNumber?: string;
  parserVersion?: string;
  transformVersion?: string;
  inputPayload: Record<string, unknown>;
  rowCounts: RunLedgerRowCounts;
  warnings: string[];
  errorPayload?: RunErrorPayload;
  startedAt: string;
  endedAt: string;
}

export interface RunLedgerDbClient {
  appendRun(record: RunLedgerRecord): Promise<void>;
}

export class RunLedgerRepository {
  constructor(private readonly dbClient: RunLedgerDbClient) {}

  async append(record: RunLedgerRecord): Promise<void> {
    if (record.errorPayload) {
      parseRunErrorPayload(record.errorPayload);
    }

    await this.dbClient.appendRun(record);
  }
}

export class InMemoryRunLedgerDbClient implements RunLedgerDbClient {
  private readonly rows: RunLedgerRecord[] = [];

  async appendRun(record: RunLedgerRecord): Promise<void> {
    this.rows.push(record);
  }

  list(): RunLedgerRecord[] {
    return [...this.rows];
  }
}
