import type {
  DashboardPayload,
  DashboardPositionRow,
  FilingArtifact,
  FilingPosition,
  RunErrorPayload
} from "@/lib/domain/contracts";
import {
  FILING_ACTIONS,
  FILING_FORM_TYPES,
  PROVIDER_ERROR_REASONS,
  RUN_KINDS,
  RUN_STATUSES,
  type FilingAction,
  type FilingFormType,
  type ProviderErrorReason
} from "@/lib/domain/enums";

const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const CIK_PATTERN = /^[0-9]{10}$/;
const RAW_CIK_PATTERN = /^[0-9]{1,10}$/;
const CUSIP_PATTERN = /^[A-Z0-9]{8,9}$/;
const TICKER_PATTERN = /^[A-Z.]{1,10}$/;

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export function normalizeCik(value: unknown): string {
  const raw = typeof value === "number" ? String(value) : expectString(value, "cik");
  const digitsOnly = raw.trim();

  if (!RAW_CIK_PATTERN.test(digitsOnly)) {
    throw new DomainValidationError('Field "cik" must be 1-10 numeric digits before normalization.');
  }

  return digitsOnly.padStart(10, "0");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainValidationError(`Field \"${fieldName}\" must be a non-empty string.`);
  }

  return value;
}

function expectBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new DomainValidationError(`Field \"${fieldName}\" must be a boolean.`);
  }

  return value;
}

function expectNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new DomainValidationError(`Field \"${fieldName}\" must be a finite number.`);
  }

  return value;
}

function expectPositiveNumber(value: unknown, fieldName: string): number {
  const numberValue = expectNumber(value, fieldName);
  if (numberValue < 0) {
    throw new DomainValidationError(`Field \"${fieldName}\" must be greater than or equal to 0.`);
  }

  return numberValue;
}

function expectOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return expectString(value, fieldName);
}

function expectEnum<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  allowedValues: T
): T[number] {
  const raw = expectString(value, fieldName);
  if (!allowedValues.includes(raw)) {
    throw new DomainValidationError(
      `Field \"${fieldName}\" must be one of: ${allowedValues.join(", ")}. Received: ${raw}.`
    );
  }

  return raw;
}

function validateOptionalPattern(value: string | undefined, fieldName: string, pattern: RegExp): void {
  if (value !== undefined && !pattern.test(value)) {
    throw new DomainValidationError(`Field \"${fieldName}\" has invalid format.`);
  }
}

function validateDateString(value: string, fieldName: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainValidationError(`Field \"${fieldName}\" must be YYYY-MM-DD.`);
  }
}

function validateIsoDateTimeString(value: string, fieldName: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new DomainValidationError(`Field \"${fieldName}\" must be an ISO date-time string.`);
  }
}

export function parseFilingArtifact(value: unknown): FilingArtifact {
  if (!isObject(value)) {
    throw new DomainValidationError("Filing artifact must be an object.");
  }

  const accessionNumber = expectString(value.accessionNumber, "accessionNumber");
  const institutionCik = expectString(value.institutionCik, "institutionCik");
  const filingFormType = expectEnum(value.filingFormType, "filingFormType", FILING_FORM_TYPES) as FilingFormType;
  const filingDate = expectString(value.filingDate, "filingDate");
  const reportPeriod = expectString(value.reportPeriod, "reportPeriod");
  const isAmendment = expectBoolean(value.isAmendment, "isAmendment");
  const isNotice = expectBoolean(value.isNotice, "isNotice");
  const amendsAccessionNumber = expectOptionalString(value.amendsAccessionNumber, "amendsAccessionNumber");
  const sourceUrl = expectOptionalString(value.sourceUrl, "sourceUrl");

  if (!ACCESSION_PATTERN.test(accessionNumber)) {
    throw new DomainValidationError("Field \"accessionNumber\" must match ##########-##-######.");
  }
  if (!CIK_PATTERN.test(institutionCik)) {
    throw new DomainValidationError("Field \"institutionCik\" must be 10 digits.");
  }
  validateDateString(filingDate, "filingDate");
  validateDateString(reportPeriod, "reportPeriod");
  validateOptionalPattern(amendsAccessionNumber, "amendsAccessionNumber", ACCESSION_PATTERN);

  if (isAmendment && !amendsAccessionNumber) {
    throw new DomainValidationError("Amendment filings require \"amendsAccessionNumber\".");
  }
  if (!isAmendment && amendsAccessionNumber) {
    throw new DomainValidationError("Non-amendment filings must omit \"amendsAccessionNumber\".");
  }
  if ((filingFormType === "13F-NT" || filingFormType === "13F-NT/A") !== isNotice) {
    throw new DomainValidationError("Notice flag must match 13F-NT form type.");
  }
  if ((filingFormType === "13F-HR/A" || filingFormType === "13F-NT/A") !== isAmendment) {
    throw new DomainValidationError("Amendment flag must match amended form type.");
  }

  if (!isObject(value.rawPayload)) {
    throw new DomainValidationError("Field \"rawPayload\" must be an object.");
  }

  return {
    accessionNumber,
    institutionCik,
    filingFormType,
    filingDate,
    reportPeriod,
    isAmendment,
    isNotice,
    amendsAccessionNumber,
    sourceUrl,
    rawPayload: value.rawPayload
  };
}

export function parseFilingPosition(value: unknown): FilingPosition {
  if (!isObject(value)) {
    throw new DomainValidationError("Filing position must be an object.");
  }

  const rowNumber = expectNumber(value.rowNumber, "rowNumber");
  if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new DomainValidationError("Field \"rowNumber\" must be a positive integer.");
  }

  const issuerName = expectString(value.issuerName, "issuerName");
  const classTitle = expectOptionalString(value.classTitle, "classTitle");
  const cusip = expectString(value.cusip, "cusip");
  const ticker = expectOptionalString(value.ticker, "ticker");
  const valueUsdThousands = expectPositiveNumber(value.valueUsdThousands, "valueUsdThousands");
  const shares = expectPositiveNumber(value.shares, "shares");
  const action = expectEnum(value.action, "action", FILING_ACTIONS) as FilingAction;

  if (!CUSIP_PATTERN.test(cusip)) {
    throw new DomainValidationError("Field \"cusip\" has invalid format.");
  }
  validateOptionalPattern(ticker, "ticker", TICKER_PATTERN);

  return {
    rowNumber,
    issuerName,
    classTitle,
    cusip,
    ticker,
    valueUsdThousands,
    shares,
    action
  };
}

function parseDashboardPositionRow(value: unknown, index: number): DashboardPositionRow {
  if (!isObject(value)) {
    throw new DomainValidationError(`Dashboard row ${index} must be an object.`);
  }

  const ticker = expectString(value.ticker, `rows[${index}].ticker`);
  const type = expectEnum(value.type, `rows[${index}].type`, FILING_ACTIONS) as FilingAction;
  const weight = expectString(value.weight, `rows[${index}].weight`);
  const cost = expectPositiveNumber(value.cost, `rows[${index}].cost`);
  const price = expectPositiveNumber(value.price, `rows[${index}].price`);
  const gap = expectString(value.gap, `rows[${index}].gap`);

  if (!TICKER_PATTERN.test(ticker)) {
    throw new DomainValidationError(`Field \"rows[${index}].ticker\" has invalid format.`);
  }

  return {
    ticker,
    type,
    weight,
    cost,
    price,
    gap
  };
}

export function parseDashboardPayload(value: unknown): DashboardPayload {
  if (!isObject(value)) {
    throw new DomainValidationError("Dashboard payload must be an object.");
  }

  const accessionNumber = expectString(value.accessionNumber, "accessionNumber");
  if (!ACCESSION_PATTERN.test(accessionNumber)) {
    throw new DomainValidationError("Field \"accessionNumber\" must match ##########-##-######.");
  }
  if (!Array.isArray(value.rows)) {
    throw new DomainValidationError("Field \"rows\" must be an array.");
  }

  return {
    accessionNumber,
    rows: value.rows.map((row, index) => parseDashboardPositionRow(row, index))
  };
}

export function parseRunErrorPayload(value: unknown): RunErrorPayload {
  if (!isObject(value)) {
    throw new DomainValidationError("Run error payload must be an object.");
  }

  const source = expectString(value.source, "source");
  const retries = expectNumber(value.retries, "retries");
  if (!Number.isInteger(retries) || retries < 0) {
    throw new DomainValidationError("Field \"retries\" must be a non-negative integer.");
  }
  const reason = expectEnum(value.reason, "reason", PROVIDER_ERROR_REASONS) as ProviderErrorReason;
  const message = expectString(value.message, "message");

  if (value.status !== undefined) {
    const status = expectNumber(value.status, "status");
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      throw new DomainValidationError("Field \"status\" must be an integer HTTP status code.");
    }
  }

  return {
    source,
    retries,
    reason,
    message,
    status: value.status as number | undefined
  };
}

export function parseRunLedgerEntry(value: unknown): void {
  if (!isObject(value)) {
    throw new DomainValidationError("Run ledger entry must be an object.");
  }

  expectEnum(value.runKind, "runKind", RUN_KINDS);
  expectEnum(value.runStatus, "runStatus", RUN_STATUSES);
  expectString(value.requestSignature, "requestSignature");

  const startedAt = expectString(value.startedAt, "startedAt");
  validateIsoDateTimeString(startedAt, "startedAt");

  if (value.endedAt !== undefined) {
    const endedAt = expectString(value.endedAt, "endedAt");
    validateIsoDateTimeString(endedAt, "endedAt");
  }

  if (value.errorPayload !== undefined) {
    parseRunErrorPayload(value.errorPayload);
  }
}
