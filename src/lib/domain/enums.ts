export const FILING_FORM_TYPES = ["13F-HR", "13F-HR/A", "13F-NT", "13F-NT/A"] as const;

export type FilingFormType = (typeof FILING_FORM_TYPES)[number];

export const FILING_ACTIONS = ["NEW", "ADD", "REDUCE", "KEEP"] as const;

export type FilingAction = (typeof FILING_ACTIONS)[number];

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "replayed"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_KINDS = ["discovery", "filing_fetch", "parse", "enrichment", "aggregate"] as const;

export type RunKind = (typeof RUN_KINDS)[number];

export const PROVIDER_ERROR_REASONS = [
  "timeout",
  "http_error",
  "network_error",
  "parse_error",
  "retry_exhausted"
] as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR_REASONS)[number];
