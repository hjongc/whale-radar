import type { FilingCoverageFlags, InstitutionUniverseRecord } from "@/lib/domain/contracts";
import { DomainValidationError, normalizeCik } from "@/lib/domain/validation";
import { InstitutionRepository } from "@/lib/db/institutions";
import type { SecCompanyTickersResponse } from "@/lib/providers/sec-client";

export interface SecUniverseDiscoveryClient {
  getCompanyTickers(): Promise<SecCompanyTickersResponse>;
}

interface UniversePayloadEntry {
  cik_str?: unknown;
  title?: unknown;
  ticker?: unknown;
  country_code?: unknown;
  forms?: unknown;
}

export interface UniverseIngestSummary {
  discoveredCount: number;
  upsertedCount: number;
  totalKnownInstitutions: number;
}

export interface UniverseIngestOptions {
  priorityCohortPercentile?: number;
  priorityCikOverrides?: Iterable<string | number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEntryList(payload: unknown): UniversePayloadEntry[] {
  if (Array.isArray(payload)) {
    return payload.filter(isObject) as UniversePayloadEntry[];
  }

  if (isObject(payload)) {
    return Object.values(payload).filter(isObject) as UniversePayloadEntry[];
  }

  throw new DomainValidationError("Universe payload must be an object map or array.");
}

function normalizeInstitutionName(value: unknown): string {
  if (typeof value !== "string") {
    throw new DomainValidationError('Field "title" must be a string.');
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new DomainValidationError('Field "title" must be a non-empty string.');
  }

  return trimmed;
}

function normalizeOptionalTicker(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new DomainValidationError('Field "ticker" must be a string when provided.');
  }

  return value.trim().toUpperCase();
}

function normalizeOptionalCountryCode(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new DomainValidationError('Field "country_code" must be a string when provided.');
  }

  const countryCode = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new DomainValidationError('Field "country_code" must be a 2-letter uppercase code.');
  }

  return countryCode;
}

function toCoverageFlags(forms: unknown): FilingCoverageFlags {
  if (!Array.isArray(forms)) {
    return {
      form13fHr: true,
      form13fHrAmendment: true,
      form13fNt: true,
      form13fNtAmendment: true
    };
  }

  const normalizedForms = new Set(
    forms
      .filter((form): form is string => typeof form === "string")
      .map((form) => form.trim().toUpperCase())
  );

  return {
    form13fHr: normalizedForms.has("13F-HR"),
    form13fHrAmendment: normalizedForms.has("13F-HR/A"),
    form13fNt: normalizedForms.has("13F-NT"),
    form13fNtAmendment: normalizedForms.has("13F-NT/A")
  };
}

export function isPriorityCohortCik(cik: string, percentile: number = 20): boolean {
  if (!/^[0-9]{10}$/.test(cik)) {
    throw new DomainValidationError('Field "cik" must be normalized to 10 digits before cohort checks.');
  }

  if (!Number.isInteger(percentile) || percentile < 1 || percentile > 100) {
    throw new DomainValidationError("Priority cohort percentile must be an integer from 1 to 100.");
  }

  const bucket = Number(cik.slice(-2));
  return bucket < percentile;
}

function normalizePriorityOverrides(values: Iterable<string | number> | undefined): Set<string> {
  const normalized = new Set<string>();
  if (!values) {
    return normalized;
  }

  for (const value of values) {
    normalized.add(normalizeCik(value));
  }

  return normalized;
}

export async function ingestInstitutionUniverse(
  payload: unknown,
  repository: InstitutionRepository,
  options: UniverseIngestOptions = {}
): Promise<UniverseIngestSummary> {
  const entries = toEntryList(payload);
  const priorityOverrides = normalizePriorityOverrides(options.priorityCikOverrides);
  const percentile = options.priorityCohortPercentile ?? 20;

  const normalizedByCik = new Map<string, InstitutionUniverseRecord>();

  for (const entry of entries) {
    const cik = normalizeCik(entry.cik_str);
    const institutionName = normalizeInstitutionName(entry.title);
    const ticker = normalizeOptionalTicker(entry.ticker);
    const countryCode = normalizeOptionalCountryCode(entry.country_code);
    const filingCoverage = toCoverageFlags(entry.forms);
    const isPriorityCohort = priorityOverrides.has(cik) || isPriorityCohortCik(cik, percentile);

    normalizedByCik.set(cik, {
      cik,
      institutionName,
      ticker,
      countryCode,
      isPriorityCohort,
      filingCoverage
    });
  }

  const upsert = await repository.upsertUniverse([...normalizedByCik.values()]);

  return {
    discoveredCount: normalizedByCik.size,
    upsertedCount: upsert.upsertedCount,
    totalKnownInstitutions: upsert.totalKnownInstitutions
  };
}

export async function discoverAndIngestInstitutionUniverse(
  secClient: SecUniverseDiscoveryClient,
  repository: InstitutionRepository,
  options: UniverseIngestOptions = {}
): Promise<UniverseIngestSummary> {
  const payload = await secClient.getCompanyTickers();
  return ingestInstitutionUniverse(payload, repository, options);
}
