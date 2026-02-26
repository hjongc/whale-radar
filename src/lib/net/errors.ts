export type ProviderErrorReason =
  | "timeout"
  | "http_error"
  | "network_error"
  | "parse_error"
  | "retry_exhausted";

export interface ProviderErrorPayload {
  source: string;
  retries: number;
  reason: ProviderErrorReason;
  message: string;
  status?: number;
}

export class ProviderRequestError extends Error {
  public readonly payload: ProviderErrorPayload;
  public readonly cause?: unknown;

  constructor(payload: ProviderErrorPayload, cause?: unknown) {
    super(payload.message);
    this.name = "ProviderRequestError";
    this.payload = payload;
    this.cause = cause;
  }
}

export function isProviderRequestError(value: unknown): value is ProviderRequestError {
  return value instanceof ProviderRequestError;
}
