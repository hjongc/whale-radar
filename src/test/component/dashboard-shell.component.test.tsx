import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DashboardShell } from "@/components/layout/dashboard-shell";

describe("DashboardShell component smoke", () => {
  it("renders shell title and tab navigation", () => {
    render(<DashboardShell />);

    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-shell-title")).toHaveTextContent("기관 보유공시 분석 대시보드");
    expect(screen.getByRole("navigation", { name: "대시보드 탭" })).toBeInTheDocument();
  });
});
