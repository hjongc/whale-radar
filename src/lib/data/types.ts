import type { FilingAction } from "@/lib/domain/enums";

export interface SectorRotationFlowDto {
  fromSector: string;
  toSector: string;
  weightPct: number;
}

export interface CashTrendPointDto {
  quarter: string;
  cashWeightPct: number;
}

export interface MarketHubAggregateDto {
  trackedInstitutions: number;
  featuredInstitutions: Array<{
    institutionName: string;
    representativeManager: string;
  }>;
  mostOwned: Array<{
    ticker: string;
    institutionCount: number;
  }>;
  hotSectorMovement: {
    sector: string;
    deltaWeightPct: number;
    summary: string;
  };
  highestMarginOfSafety: {
    ticker: string;
    gapPct: number;
    accession: string;
    priceTimestamp: string;
    calcVersion: string;
    source: string;
    freshness: "fresh" | "stale";
    staleReason?: string;
  };
  sectorRotation: {
    updatedQuarter: string;
    flows: SectorRotationFlowDto[];
  };
  sectorConcentration: Array<{
    sector: string;
    weightPct: number;
  }>;
  cashTrend: {
    series: CashTrendPointDto[];
  };
}

export interface WhaleHoldingRowDto {
  ticker: string;
  issuerName: string;
  type: FilingAction;
  valueUsdThousands: number;
  shares: number;
  weight: string;
  cost: number | null;
  price: number;
  gap: string | null;
  gapReason?: string;
  accession: string;
  priceTimestamp: string;
  calcVersion: string;
  source: string;
  freshness: "fresh" | "stale";
  staleReason?: string;
}

export interface WhaleGapRankingItemDto {
  ticker: string;
  gap: string;
  type: FilingAction;
  accession: string;
  priceTimestamp: string;
  calcVersion: string;
  source: string;
  freshness: "fresh" | "stale";
  staleReason?: string;
}

export interface WhaleActionMixItemDto {
  type: FilingAction;
  count: number;
}

export interface WhaleHoldingsQueryInput {
  managerId: string;
  page?: string | null;
  pageSize?: string | null;
  action?: string | null;
  search?: string | null;
}

export interface WhaleHoldingsQueryParams {
  managerId: string;
  page: number;
  pageSize: number;
  action: "ALL" | FilingAction;
  search?: string;
}

export interface WhaleInsiderAggregateDto {
  manager: {
    managerId: string;
    managerName: string;
    reportPeriod: string;
  };
  gapRanking: WhaleGapRankingItemDto[];
  actionMix: WhaleActionMixItemDto[];
  holdingsTable: {
    rows: WhaleHoldingRowDto[];
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
    filters: {
      action: "ALL" | FilingAction;
      search?: string;
    };
  };
}

export interface WhaleManagerDirectoryItemDto {
  managerId: string;
  managerName: string;
  institutionName: string;
  representativeManager: string;
  reportPeriod: string;
  latestFilingDate: string;
  holdingsCount: number;
  totalValueUsdThousands: number;
  rank: number;
  stale: boolean;
}

export interface QueryValidationErrorDto {
  error: {
    code: "invalid_query_params";
    message: string;
    details: Array<{
      field: string;
      reason: string;
      allowedValues?: string[];
      received?: string;
    }>;
  };
}
