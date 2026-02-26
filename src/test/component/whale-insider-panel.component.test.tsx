import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { queryWhaleInsiderAggregates } from "@/lib/data/aggregate-queries";
import { seedAggregateSource } from "@/lib/data/mock-source";

function mockWhaleAggregateResponse(payload: unknown) {
  const basePayload = payload as {
    manager?: {
      managerId?: string;
      managerName?: string;
      reportPeriod?: string;
    };
    holdingsTable?: {
      rows?: Array<{ type?: string }>;
      pageSize?: number;
      totalRows?: number;
      totalPages?: number;
      page?: number;
    };
  };

  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/api/aggregates/whales/managers")) {
        const managerDirectory = [
          {
            managerId: basePayload.manager?.managerId ?? "berkshire",
            managerName: basePayload.manager?.managerName ?? "Berkshire Hathaway",
            institutionName: basePayload.manager?.managerName ?? "Berkshire Hathaway",
            representativeManager: "Warren Buffett",
            reportPeriod: basePayload.manager?.reportPeriod ?? "2025-12-31",
            latestFilingDate: basePayload.manager?.reportPeriod ?? "2025-12-31",
            holdingsCount: basePayload.holdingsTable?.rows?.length ?? 0,
            totalValueUsdThousands: 0,
            rank: 1,
            stale: false
          }
        ];

        return new Response(JSON.stringify(managerDirectory), {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        });
      }

      const action = new URL(url, "http://localhost").searchParams.get("action") ?? "ALL";

      const cloned = JSON.parse(JSON.stringify(basePayload));
      const rows = cloned?.holdingsTable?.rows ?? [];
      const filteredRows = action === "ALL" ? rows : rows.filter((row: { type?: string }) => row.type === action);

      if (cloned?.holdingsTable) {
        const pageSize = Number(cloned.holdingsTable.pageSize ?? 50);
        cloned.holdingsTable.rows = filteredRows;
        cloned.holdingsTable.totalRows = filteredRows.length;
        cloned.holdingsTable.totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
        cloned.holdingsTable.page = 1;
      }

      return new Response(JSON.stringify(cloned), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    })
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Whale Insider chart coupling", () => {
  it("highlights a matching row after gap bar click", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 50,
      action: "ALL"
    }, seedAggregateSource);

    mockWhaleAggregateResponse(dto);

    render(<DashboardShell initialTab="whale" />);
    const user = userEvent.setup();

    const targetRow = await screen.findByTestId("positions-row-AMZN");
    await user.click(screen.getByTestId("gap-bar-AMZN"));

    await waitFor(() => {
      expect(targetRow).toHaveClass("row-highlight");
    });

  });

  it("applies an enum-safe table filter after action segment click", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 50,
      action: "ALL"
    }, seedAggregateSource);

    mockWhaleAggregateResponse(dto);

    render(<DashboardShell initialTab="whale" />);
    const user = userEvent.setup();

    await screen.findByTestId("positions-row-AAPL");
    await user.click(screen.getByTestId("change-mix-segment-NEW"));

    expect(screen.getByTestId("active-action-filter")).toHaveTextContent("NEW");
    expect(screen.getByTestId("positions-row-AMZN")).toBeInTheDocument();
    expect(screen.queryByTestId("positions-row-AAPL")).not.toBeInTheDocument();
  });

  it("renders and applies all filter chips including KEEP", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 50,
      action: "ALL"
    }, seedAggregateSource);

    mockWhaleAggregateResponse(dto);

    render(<DashboardShell initialTab="whale" />);
    const user = userEvent.setup();

    await screen.findByTestId("positions-row-AAPL");

    expect(screen.getByRole("tab", { name: "ALL" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "NEW" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "ADD" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "REDUCE" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "KEEP" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "KEEP" }));

    expect(screen.getByTestId("active-action-filter")).toHaveTextContent("KEEP");
    expect(screen.queryByTestId("positions-row-AAPL")).not.toBeInTheDocument();
  });

  it("clears stale row highlight when filter context excludes ticker", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 50,
      action: "ALL"
    }, seedAggregateSource);

    mockWhaleAggregateResponse(dto);

    render(<DashboardShell initialTab="whale" />);
    const user = userEvent.setup();

    await screen.findByTestId("positions-row-AAPL");
    await user.click(screen.getByTestId("gap-bar-AAPL"));
    expect(screen.getByTestId("positions-row-AAPL")).toHaveClass("row-highlight");

    await user.click(screen.getByRole("tab", { name: "NEW" }));

    await waitFor(() => {
      expect(screen.queryByTestId("positions-row-AAPL")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("tab", { name: "ALL" }));
    await waitFor(() => {
      expect(screen.getByTestId("positions-row-AAPL")).not.toHaveClass("row-highlight");
    });
  });

  it("shows fallback warning and keeps filter unchanged for unknown action labels", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 50,
      action: "ALL"
    }, seedAggregateSource);

    const unsupportedPayload = {
      ...dto,
      actionMix: [{ type: "LEGACY", count: 2 }, ...dto.actionMix]
    };

    mockWhaleAggregateResponse(unsupportedPayload);

    render(<DashboardShell initialTab="whale" />);
    const user = userEvent.setup();

    await screen.findByTestId("positions-row-AAPL");
    await user.click(screen.getByTestId("change-mix-segment-UNKNOWN"));

    expect(screen.getByTestId("active-action-filter")).toHaveTextContent("ALL");
    expect(screen.getByTestId("action-label-warning")).toHaveTextContent(
      'Unsupported action label "Unsupported (LEGACY)". Filter remains unchanged.'
    );
  });

  it("shows N/A for expected and gap when previous basis is unavailable", async () => {
    const dto = await queryWhaleInsiderAggregates({
      managerId: "berkshire",
      page: 1,
      pageSize: 50,
      action: "ALL"
    }, seedAggregateSource);

    const mutated = {
      ...dto,
      holdingsTable: {
        ...dto.holdingsTable,
        rows: dto.holdingsTable.rows.map((row, index) =>
          index === 0
            ? {
                ...row,
                cost: null,
                gap: null,
                gapReason: "no_previous_cost_basis"
              }
            : row
        )
      }
    };

    mockWhaleAggregateResponse(mutated);

    render(<DashboardShell initialTab="whale" />);

    await screen.findByTestId("positions-row-AAPL");

    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });

});
