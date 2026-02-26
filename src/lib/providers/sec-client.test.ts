import { describe, expect, it, vi } from "vitest";

import { SecClient } from "@/lib/providers/sec-client";

describe("SecClient", () => {
  it("sends compliant User-Agent header", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          cik: "0000320193",
          name: "Test Institution"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const client = new SecClient(
      {
        userAgent: "WhaleInsightPro/0.1 (ops@whaleinsight.test)",
        baseUrl: "https://sec.example",
        rateLimit: { maxRequests: 10, perMilliseconds: 1_000 }
      },
      {
        fetchImpl,
        sleep: async () => {},
        random: () => 0
      }
    );

    await client.getSubmissions("320193");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected SEC fetch call to be captured");
    }
    const [url, init] = firstCall;
    expect(url).toBe("https://sec.example/submissions/CIK0000320193.json");
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("User-Agent")).toBe("WhaleInsightPro/0.1 (ops@whaleinsight.test)");
  });

  it("fetches the SEC broad filer universe payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const client = new SecClient(
      {
        userAgent: "WhaleInsightPro/0.1 (ops@whaleinsight.test)",
        baseUrl: "https://sec.example"
      },
      {
        fetchImpl,
        sleep: async () => {},
        random: () => 0
      }
    );

    const universe = await client.getCompanyTickers();

    expect(universe["0"]?.ticker).toBe("AAPL");
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected SEC fetch call to be captured");
    }
    const [url] = firstCall;
    expect(url).toBe("https://sec.example/files/company_tickers.json");
  });

  it("fetches accession archive index metadata for filing artifacts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          directory: {
            item: [{ name: "primary_doc.xml", type: "text/xml" }]
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const client = new SecClient(
      {
        userAgent: "WhaleInsightPro/0.1 (ops@whaleinsight.test)",
        baseUrl: "https://sec.example"
      },
      {
        fetchImpl,
        sleep: async () => {},
        random: () => 0
      }
    );

    const indexPayload = await client.getFilingIndex("0001067983", "0001067983-25-000001");

    expect(indexPayload.directory?.item?.[0]?.name).toBe("primary_doc.xml");
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
      throw new Error("Expected SEC archive fetch call to be captured");
    }
    const [url] = firstCall;
    expect(url).toBe("https://sec.example/Archives/edgar/data/1067983/000106798325000001/index.json");
  });
});
