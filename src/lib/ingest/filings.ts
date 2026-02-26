import { createHash, randomUUID } from "node:crypto";

import { FilingRepository } from "@/lib/db/filings";
import { RunLedgerRepository, type RunLedgerRecord } from "@/lib/db/runs";
import type { FilingArtifact, RunErrorPayload } from "@/lib/domain/contracts";
import { FILING_FORM_TYPES, type FilingFormType, type RunStatus } from "@/lib/domain/enums";
import { DomainValidationError, normalizeCik, parseFilingArtifact } from "@/lib/domain/validation";
import { ProviderRequestError } from "@/lib/net/errors";
import type { SecArchiveIndexResponse, SecSubmissionsResponse } from "@/lib/providers/sec-client";

const DEFAULT_TRIGGER_MODE = "manual";
const DEFAULT_PARSER_VERSION = "raw-metadata-v1";

interface RecentSubmissionRow {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string;
  acceptanceDateTime?: string;
  filingManagerName?: string;
  filingManagerCik?: string;
  primaryDocument?: string;
  amendsAccessionNumber?: string;
}

export interface SecFilingFetchClient {
  getSubmissions(cik: string): Promise<SecSubmissionsResponse>;
  getFilingIndex(cik: string, accessionNumber: string): Promise<SecArchiveIndexResponse>;
}

export interface FilingFetchRunOptions {
  institutionCik: string | number;
  accessionNumber: string;
  triggerMode?: string;
  parserVersion?: string;
  transformVersion?: string;
  now?: () => Date;
  runIdFactory?: () => string;
}

export interface FilingFetchRunResult {
  runId: string;
  requestSignature: string;
  runStatus: RunStatus;
  filingCreated: boolean;
  rowCounts: Record<string, number>;
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAccessions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new DomainValidationError("SEC submissions recent.accessionNumber must be an array.");
  }

  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new DomainValidationError("SEC submissions accession entries must be non-empty strings.");
    }

    return entry.trim();
  });
}

function valueAtIndex(value: unknown, index: number): unknown {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value[index];
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredString(value: unknown, fieldName: string): string {
  const parsed = optionalString(value);
  if (!parsed) {
    throw new DomainValidationError(`SEC submissions field "${fieldName}" must be a non-empty string.`);
  }

  return parsed;
}

function findRecentSubmissionRow(payload: SecSubmissionsResponse, accessionNumber: string): RecentSubmissionRow {
  const recent = isObject(payload.filings) && isObject(payload.filings.recent) ? payload.filings.recent : null;
  if (!recent) {
    throw new DomainValidationError("SEC submissions payload is missing filings.recent object.");
  }

  const accessions = normalizeAccessions(recent.accessionNumber);
  const targetIndex = accessions.findIndex((candidate) => candidate === accessionNumber);
  if (targetIndex === -1) {
    throw new DomainValidationError(`Accession ${accessionNumber} not found in SEC submissions recent filings.`);
  }

  return {
    accessionNumber,
    form: requiredString(valueAtIndex(recent.form, targetIndex), "form"),
    filingDate: requiredString(valueAtIndex(recent.filingDate, targetIndex), "filingDate"),
    reportDate: requiredString(valueAtIndex(recent.reportDate, targetIndex), "reportDate"),
    acceptanceDateTime: optionalString(valueAtIndex(recent.acceptanceDateTime, targetIndex)),
    filingManagerName: optionalString(valueAtIndex(recent.filingManagerName, targetIndex)),
    filingManagerCik: optionalString(valueAtIndex(recent.filingManagerCik, targetIndex)),
    primaryDocument: optionalString(valueAtIndex(recent.primaryDocument, targetIndex))
  };
}

function parseFilingFormType(value: string): FilingFormType {
  const normalized = value.trim().toUpperCase();
  if (!FILING_FORM_TYPES.includes(normalized as FilingFormType)) {
    throw new DomainValidationError(`Unsupported SEC filing form type for task-8 ingest: ${value}.`);
  }

  return normalized as FilingFormType;
}

function buildRequestSignature(cik: string, accessionNumber: string): string {
  return createHash("sha256").update(`${cik}:${accessionNumber}`).digest("hex").slice(0, 20);
}

function toRunErrorPayload(error: unknown): RunErrorPayload {
  if (error instanceof ProviderRequestError) {
    return error.payload;
  }

  if (error instanceof DomainValidationError) {
    return {
      source: "ingest",
      retries: 0,
      reason: "parse_error",
      message: error.message
    };
  }

  if (error instanceof Error) {
    return {
      source: "ingest",
      retries: 0,
      reason: "network_error",
      message: error.message
    };
  }

  return {
    source: "ingest",
    retries: 0,
    reason: "network_error",
    message: "Unknown ingestion failure"
  };
}

function buildSourceUrl(cik: string, accessionNumber: string, primaryDocument: string | undefined): string | undefined {
  if (!primaryDocument) {
    return undefined;
  }

  const cikWithoutPadding = String(Number(cik));
  const accessionArchiveKey = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikWithoutPadding}/${accessionArchiveKey}/${primaryDocument}`;
}

function toFilingArtifact(
  normalizedCik: string,
  row: RecentSubmissionRow,
  indexPayload: SecArchiveIndexResponse
): FilingArtifact {
  const filingFormType = parseFilingFormType(row.form);
  const isAmendment = filingFormType.endsWith("/A");
  const isNotice = filingFormType.startsWith("13F-NT");

  return parseFilingArtifact({
    accessionNumber: row.accessionNumber,
    institutionCik: normalizedCik,
    filingFormType,
    filingDate: row.filingDate,
    reportPeriod: row.reportDate,
    isAmendment,
    isNotice,
    amendsAccessionNumber: isAmendment ? row.amendsAccessionNumber ?? row.accessionNumber : undefined,
    sourceUrl: buildSourceUrl(normalizedCik, row.accessionNumber, row.primaryDocument),
    rawPayload: {
      submissionRow: row,
      filingIndex: indexPayload
    }
  });
}

function finalizeLedgerRecord(
  base: Omit<RunLedgerRecord, "runStatus" | "rowCounts" | "warnings" | "errorPayload" | "endedAt">,
  runStatus: RunStatus,
  rowCounts: Record<string, number>,
  warnings: string[],
  endedAt: string,
  errorPayload?: RunErrorPayload
): RunLedgerRecord {
  return {
    ...base,
    runStatus,
    rowCounts,
    warnings,
    errorPayload,
    endedAt
  };
}

export async function fetchAndStoreFilingByAccession(
  secClient: SecFilingFetchClient,
  filingRepository: FilingRepository,
  runLedgerRepository: RunLedgerRepository,
  options: FilingFetchRunOptions
): Promise<FilingFetchRunResult> {
  const now = options.now ?? (() => new Date());
  const runIdFactory = options.runIdFactory ?? randomUUID;
  const normalizedCik = normalizeCik(options.institutionCik);
  const runId = runIdFactory();
  const requestSignature = buildRequestSignature(normalizedCik, options.accessionNumber);
  const startedAt = now().toISOString();

  const ledgerBase: Omit<RunLedgerRecord, "runStatus" | "rowCounts" | "warnings" | "errorPayload" | "endedAt"> = {
    runId,
    runKind: "filing_fetch",
    triggerMode: options.triggerMode ?? DEFAULT_TRIGGER_MODE,
    requestSignature,
    targetAccessionNumber: options.accessionNumber,
    parserVersion: options.parserVersion ?? DEFAULT_PARSER_VERSION,
    transformVersion: options.transformVersion,
    inputPayload: {
      institutionCik: normalizedCik,
      accessionNumber: options.accessionNumber,
      triggerMode: options.triggerMode ?? DEFAULT_TRIGGER_MODE
    },
    startedAt
  };

  try {
    const submissions = await secClient.getSubmissions(normalizedCik);
    const recentRow = findRecentSubmissionRow(submissions, options.accessionNumber);
    const filingIndex = await secClient.getFilingIndex(normalizedCik, options.accessionNumber);
    const filingArtifact = toFilingArtifact(normalizedCik, recentRow, filingIndex);
    const upsert = await filingRepository.upsertByAccession(filingArtifact);

    const warnings = upsert.created
      ? []
      : [`Accession ${options.accessionNumber} already exists; replay completed without duplicate filing row.`];
    const runStatus: RunStatus = upsert.created ? "succeeded" : "replayed";
    const rowCounts = {
      filingsFetched: 1,
      filingsInserted: upsert.created ? 1 : 0,
      totalKnownFilings: upsert.totalKnownFilings
    };

    await runLedgerRepository.append(
      finalizeLedgerRecord(ledgerBase, runStatus, rowCounts, warnings, now().toISOString())
    );

    return {
      runId,
      requestSignature,
      runStatus,
      filingCreated: upsert.created,
      rowCounts,
      warnings
    };
  } catch (error: unknown) {
    const errorPayload = toRunErrorPayload(error);
    const totalKnownFilings = await filingRepository.countKnownFilings();

    await runLedgerRepository.append(
      finalizeLedgerRecord(
        ledgerBase,
        "failed",
        {
          filingsFetched: 0,
          filingsInserted: 0,
          totalKnownFilings
        },
        [],
        now().toISOString(),
        errorPayload
      )
    );

    throw error;
  }
}
