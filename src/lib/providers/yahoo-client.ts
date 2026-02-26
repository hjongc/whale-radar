import { fetchJsonWithPolicy, type FetchJsonPolicy, type PolicyFetchDependencies } from "@/lib/net/fetch-json";
import { RateLimiter } from "@/lib/net/rate-limiter";

export interface YahooClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  rateLimit?: {
    maxRequests: number;
    perMilliseconds: number;
  };
}

export interface YahooChartResult {
  meta?: {
    symbol?: string;
    currency?: string;
    exchangeName?: string;
  };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

export interface YahooChartResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code?: string; description?: string } | null;
  };
}

const YAHOO_SOURCE = "yahoo";

export class YahooPriceClient {
  private readonly baseUrl: string;
  private readonly policy: FetchJsonPolicy;
  private readonly dependencies: PolicyFetchDependencies;

  constructor(config: YahooClientConfig = {}, dependencies: PolicyFetchDependencies = {}) {
    this.baseUrl = config.baseUrl ?? "https://query1.finance.yahoo.com";
    this.policy = {
      timeoutMs: config.timeoutMs ?? 8_000,
      retry: {
        maxRetries: config.maxRetries ?? 2,
        baseDelayMs: 150,
        maxDelayMs: 1_000,
        jitterMs: 100
      },
      rateLimiter: new RateLimiter({
        maxRequests: config.rateLimit?.maxRequests ?? 4,
        perMilliseconds: config.rateLimit?.perMilliseconds ?? 1_000
      })
    };
    this.dependencies = dependencies;
  }

  async getPriceChart(
    symbol: string,
    options: { interval?: string; range?: string } = {}
  ): Promise<YahooChartResponse> {
    const query = new URLSearchParams({
      interval: options.interval ?? "1d",
      range: options.range ?? "1y"
    });

    return fetchJsonWithPolicy<YahooChartResponse>(
      {
        source: YAHOO_SOURCE,
        url: `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?${query.toString()}`,
        init: {
          headers: {
            Accept: "application/json"
          }
        }
      },
      this.policy,
      this.dependencies
    );
  }
}
