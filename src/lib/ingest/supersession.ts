import type { ParsedFilingStatus, ParsedInformationTableResult } from "@/lib/ingest/parser/information-table";

export interface FilingLineageRecord {
  accessionNumber: string;
  institutionCik: string;
  reportPeriod: string;
  filingDate: string;
  filingFormType: string;
  status: ParsedFilingStatus;
  isAmendment: boolean;
  amendsAccessionNumber?: string;
  rootAccessionNumber: string;
  supersedesAccessionNumber?: string;
  supersededByAccessionNumber?: string;
  isActive: boolean;
}

export interface SupersessionSnapshot {
  activeFilingByPeriod: Record<string, string>;
  activeHoldingsByPeriod: Record<string, ParsedInformationTableResult["holdings"]>;
  lineage: FilingLineageRecord[];
}

function filingSortOrder(a: ParsedInformationTableResult, b: ParsedInformationTableResult): number {
  const byDate = a.filingDate.localeCompare(b.filingDate);
  if (byDate !== 0) {
    return byDate;
  }

  return a.accessionNumber.localeCompare(b.accessionNumber);
}

function reportPeriodKey(filing: ParsedInformationTableResult): string {
  return `${filing.institutionCik}:${filing.reportPeriod}`;
}

function toLineageRecord(filing: ParsedInformationTableResult, rootAccessionNumber: string): FilingLineageRecord {
  return {
    accessionNumber: filing.accessionNumber,
    institutionCik: filing.institutionCik,
    reportPeriod: filing.reportPeriod,
    filingDate: filing.filingDate,
    filingFormType: filing.filingFormType,
    status: filing.status,
    isAmendment: filing.isAmendment,
    amendsAccessionNumber: filing.amendsAccessionNumber,
    rootAccessionNumber,
    isActive: true
  };
}

function resolveSupersedesAccession(
  filing: ParsedInformationTableResult,
  activeAccessionByPeriod: Map<string, string>,
  lineageByAccession: Map<string, FilingLineageRecord>
): string | undefined {
  if (filing.isAmendment && filing.amendsAccessionNumber && lineageByAccession.has(filing.amendsAccessionNumber)) {
    return filing.amendsAccessionNumber;
  }

  return activeAccessionByPeriod.get(reportPeriodKey(filing));
}

export function buildSupersessionSnapshot(filings: ParsedInformationTableResult[]): SupersessionSnapshot {
  const ordered = [...filings].sort(filingSortOrder);
  const lineageByAccession = new Map<string, FilingLineageRecord>();
  const lineageOrder: string[] = [];
  const activeAccessionByPeriod = new Map<string, string>();
  const activeHoldingsByPeriod = new Map<string, ParsedInformationTableResult["holdings"]>();

  for (const filing of ordered) {
    const supersedesAccessionNumber = resolveSupersedesAccession(filing, activeAccessionByPeriod, lineageByAccession);
    const supersededRecord = supersedesAccessionNumber
      ? lineageByAccession.get(supersedesAccessionNumber)
      : undefined;
    const rootAccessionNumber = supersededRecord?.rootAccessionNumber ?? filing.amendsAccessionNumber ?? filing.accessionNumber;
    const record = toLineageRecord(filing, rootAccessionNumber);

    if (supersededRecord) {
      supersededRecord.supersededByAccessionNumber = filing.accessionNumber;
      supersededRecord.isActive = false;
      record.supersedesAccessionNumber = supersededRecord.accessionNumber;
    }

    lineageByAccession.set(record.accessionNumber, record);
    lineageOrder.push(record.accessionNumber);

    const key = reportPeriodKey(filing);
    activeAccessionByPeriod.set(key, filing.accessionNumber);
    activeHoldingsByPeriod.set(key, filing.status === "notice_only" ? [] : filing.holdings);
  }

  return {
    activeFilingByPeriod: Object.fromEntries(activeAccessionByPeriod),
    activeHoldingsByPeriod: Object.fromEntries(activeHoldingsByPeriod),
    lineage: lineageOrder
      .map((accessionNumber) => lineageByAccession.get(accessionNumber))
      .filter((record): record is FilingLineageRecord => Boolean(record))
  };
}
