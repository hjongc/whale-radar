import { ProviderRequestError, type ProviderErrorReason } from "@/lib/net/errors";
import { RateLimiter } from "@/lib/net/rate-limiter";
import { type RetryDependencies, type RetryPolicy, waitBeforeRetry } from "@/lib/net/retry";

export interface PolicyFetchDependencies extends RetryDependencies {
  fetchImpl?: typeof fetch;
}

export interface FetchJsonPolicy {
  timeoutMs: number;
  retry: RetryPolicy;
  rateLimiter: RateLimiter;
}

export interface FetchJsonRequest {
  source: string;
  url: string;
  init?: Omit<RequestInit, "signal">;
}

const DEFAULT_RETRIABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function withTimeout(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId)
  };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function buildProviderError(
  source: string,
  retries: number,
  reason: ProviderErrorReason,
  message: string,
  status?: number,
  cause?: unknown
): ProviderRequestError {
  return new ProviderRequestError({ source, retries, reason, message, status }, cause);
}

export async function fetchJsonWithPolicy<T>(
  request: FetchJsonRequest,
  policy: FetchJsonPolicy,
  dependencies: PolicyFetchDependencies = {}
): Promise<T> {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let lastError: ProviderRequestError | null = null;

  for (let attempt = 0; attempt <= policy.retry.maxRetries; attempt += 1) {
    await policy.rateLimiter.acquire();
    const { signal, cleanup } = withTimeout(policy.timeoutMs);

    try {
      const response = await fetchImpl(request.url, { ...request.init, signal });
      if (!response.ok) {
        const reason: ProviderErrorReason = "http_error";
        const message = `Upstream returned HTTP ${response.status}`;
        const error = buildProviderError(
          request.source,
          attempt,
          reason,
          message,
          response.status
        );

        if (attempt < policy.retry.maxRetries && DEFAULT_RETRIABLE_STATUSES.has(response.status)) {
          lastError = error;
          await waitBeforeRetry(attempt, policy.retry, dependencies);
          continue;
        }

        throw error;
      }

      try {
        return (await response.json()) as T;
      } catch (error: unknown) {
        throw buildProviderError(
          request.source,
          attempt,
          "parse_error",
          "Failed to parse upstream JSON payload",
          response.status,
          error
        );
      }
    } catch (error: unknown) {
      if (error instanceof ProviderRequestError) {
        throw error;
      }

      const reason: ProviderErrorReason = isTimeoutError(error) ? "timeout" : "network_error";
      const typed = buildProviderError(
        request.source,
        attempt,
        reason,
        reason === "timeout" ? "Upstream request timed out" : "Upstream request failed",
        undefined,
        error
      );

      if (attempt < policy.retry.maxRetries) {
        lastError = typed;
        await waitBeforeRetry(attempt, policy.retry, dependencies);
        continue;
      }

      throw typed;
    } finally {
      cleanup();
    }
  }

  if (lastError) {
    throw buildProviderError(
      request.source,
      policy.retry.maxRetries,
      "retry_exhausted",
      `Retry limit exhausted for ${request.source}`,
      lastError.payload.status,
      lastError
    );
  }

  throw buildProviderError(
    request.source,
    policy.retry.maxRetries,
    "retry_exhausted",
    `Retry limit exhausted for ${request.source}`
  );
}
