import { fetchJsonWithPolicy, type FetchJsonPolicy, type PolicyFetchDependencies } from "@/lib/net/fetch-json";
import { RateLimiter } from "@/lib/net/rate-limiter";

export interface SecClientConfig {
  userAgent: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  rateLimit?: {
    maxRequests: number;
    perMilliseconds: number;
  };
}

export interface SecSubmissionsResponse {
  cik: string;
  entityType?: string;
  name?: string;
  filings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SecCompanyTickersEntry {
  cik_str?: number;
  ticker?: string;
  title?: string;
  [key: string]: unknown;
}

export type SecCompanyTickersResponse = Record<string, SecCompanyTickersEntry>;

export interface SecArchiveIndexItem {
  name?: string;
  type?: string;
  size?: number;
  lastModified?: string;
  href?: string;
  [key: string]: unknown;
}

export interface SecArchiveIndexResponse {
  directory?: {
    name?: string;
    parentDir?: string;
    item?: SecArchiveIndexItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const SEC_SOURCE = "sec";

function toPaddedCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  return digits.padStart(10, "0");
}

function toAccessionArchiveKey(accessionNumber: string): string {
  return accessionNumber.replace(/-/g, "");
}

export class SecClient {
  private readonly userAgent: string;
  private readonly baseUrl: string;
  private readonly policy: FetchJsonPolicy;
  private readonly dependencies: PolicyFetchDependencies;

  constructor(config: SecClientConfig, dependencies: PolicyFetchDependencies = {}) {
    if (!config.userAgent.trim()) {
      throw new Error("SEC client requires a non-empty User-Agent");
    }

    this.userAgent = config.userAgent;
    this.baseUrl = config.baseUrl ?? "https://data.sec.gov";
    this.policy = {
      timeoutMs: config.timeoutMs ?? 10_000,
      retry: {
        maxRetries: config.maxRetries ?? 2,
        baseDelayMs: 200,
        maxDelayMs: 1_500,
        jitterMs: 100
      },
      rateLimiter: new RateLimiter({
        maxRequests: config.rateLimit?.maxRequests ?? 8,
        perMilliseconds: config.rateLimit?.perMilliseconds ?? 1_000
      })
    };
    this.dependencies = dependencies;
  }

  async getSubmissions(cik: string): Promise<SecSubmissionsResponse> {
    const normalizedCik = toPaddedCik(cik);
    return fetchJsonWithPolicy<SecSubmissionsResponse>(
      {
        source: SEC_SOURCE,
        url: `${this.baseUrl}/submissions/CIK${normalizedCik}.json`,
        init: {
          headers: this.headers()
        }
      },
      this.policy,
      this.dependencies
    );
  }

  async getCompanyTickers(): Promise<SecCompanyTickersResponse> {
    return fetchJsonWithPolicy<SecCompanyTickersResponse>(
      {
        source: SEC_SOURCE,
        url: `${this.baseUrl}/files/company_tickers.json`,
        init: {
          headers: this.headers()
        }
      },
      this.policy,
      this.dependencies
    );
  }

  async getFilingIndex(cik: string, accessionNumber: string): Promise<SecArchiveIndexResponse> {
    const normalizedCik = String(Number(toPaddedCik(cik)));
    const accessionArchiveKey = toAccessionArchiveKey(accessionNumber);

    return fetchJsonWithPolicy<SecArchiveIndexResponse>(
      {
        source: SEC_SOURCE,
        url: `${this.baseUrl}/Archives/edgar/data/${normalizedCik}/${accessionArchiveKey}/index.json`,
        init: {
          headers: this.headers()
        }
      },
      this.policy,
      this.dependencies
    );
  }

  private headers(): Headers {
    return new Headers({
      "User-Agent": this.userAgent,
      Accept: "application/json"
    });
  }
}
