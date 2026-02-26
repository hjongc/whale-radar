import type { FilingAction, FilingFormType, ProviderErrorReason, RunKind, RunStatus } from "@/lib/domain/enums";

export interface FilingArtifact {
  accessionNumber: string;
  institutionCik: string;
  filingFormType: FilingFormType;
  filingDate: string;
  reportPeriod: string;
  isAmendment: boolean;
  isNotice: boolean;
  amendsAccessionNumber?: string;
  sourceUrl?: string;
  rawPayload: Record<string, unknown>;
}

export interface FilingPosition {
  rowNumber: number;
  issuerName: string;
  classTitle?: string;
  cusip: string;
  ticker?: string;
  valueUsdThousands: number;
  shares: number;
  action: FilingAction;
}

export interface DashboardPositionRow {
  ticker: string;
  type: FilingAction;
  weight: string;
  cost: number;
  price: number;
  gap: string;
}

export interface DashboardPayload {
  accessionNumber: string;
  rows: DashboardPositionRow[];
}

export interface RunErrorPayload {
  source: string;
  retries: number;
  reason: ProviderErrorReason;
  message: string;
  status?: number;
}

export interface RunLedgerEntry {
  runKind: RunKind;
  runStatus: RunStatus;
  requestSignature: string;
  startedAt: string;
  endedAt?: string;
  errorPayload?: RunErrorPayload;
}

export interface FilingCoverageFlags {
  form13fHr: boolean;
  form13fHrAmendment: boolean;
  form13fNt: boolean;
  form13fNtAmendment: boolean;
}

export interface InstitutionUniverseRecord {
  cik: string;
  institutionName: string;
  ticker?: string;
  countryCode?: string;
  isPriorityCohort: boolean;
  filingCoverage: FilingCoverageFlags;
}
